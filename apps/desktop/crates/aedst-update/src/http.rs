//! Production [`ManifestFetcher`] and [`PackageFetcher`] over `reqwest` (rustls, platform certificate verifier).
//!
//! The transport policy is enforced here as well as in the service: only URLs that pass
//! [`crate::url_policy::validate_url`], redirects only within the original host, at most
//! [`crate::url_policy::MAX_REDIRECTS`] of them, bodies capped while streaming. Whether a downloaded file is
//! genuine is not decided here; the caller verifies it against the signed manifest.

use std::path::Path;
use std::time::Duration;

use futures::StreamExt;
use futures::future::BoxFuture;
use reqwest::redirect::Policy;
use tokio::io::AsyncWriteExt;
use url::Url;

use crate::ports::{FetchError, ManifestFetcher, PackageFetcher, ProgressFn};
use crate::url_policy::{MAX_REDIRECTS, check_redirect, validate_url};

const CONNECT_TIMEOUT: Duration = Duration::from_secs(15);
const READ_TIMEOUT: Duration = Duration::from_secs(30);
const MANIFEST_TIMEOUT: Duration = Duration::from_secs(30);

/// HTTP transport for manifests and packages.
#[derive(Debug, Clone)]
pub struct HttpFetcher {
    client: reqwest::Client,
}

impl HttpFetcher {
    /// A fetcher sending `user_agent` (for example `desktop/1.2.3`).
    ///
    /// # Errors
    /// [`FetchError`] when the TLS backend cannot be initialised.
    pub fn new(user_agent: &str) -> Result<Self, FetchError> {
        let redirects = Policy::custom(|attempt| {
            if attempt.previous().len() >= MAX_REDIRECTS {
                return attempt.error("too many redirects");
            }
            let verdict = attempt
                .previous()
                .first()
                .map(|first| check_redirect(first, attempt.url()));
            match verdict {
                Some(Ok(())) => attempt.follow(),
                Some(Err(e)) => attempt.error(e.to_string()),
                None => attempt.error("redirect without an origin"),
            }
        });
        let client = reqwest::Client::builder()
            .user_agent(user_agent)
            .redirect(redirects)
            .connect_timeout(CONNECT_TIMEOUT)
            .read_timeout(READ_TIMEOUT)
            .build()
            .map_err(|e| FetchError(e.to_string()))?;
        Ok(Self { client })
    }

    async fn get(&self, url: &Url) -> Result<reqwest::Response, FetchError> {
        validate_url(url.as_str()).map_err(|e| FetchError(e.to_string()))?;
        let response = self
            .client
            .get(url.clone())
            .send()
            .await
            .map_err(|e| FetchError(e.without_url().to_string()))?;
        if !response.status().is_success() {
            return Err(FetchError(format!("HTTP {}", response.status().as_u16())));
        }
        Ok(response)
    }
}

impl ManifestFetcher for HttpFetcher {
    fn fetch<'a>(
        &'a self,
        url: &'a Url,
        max_bytes: usize,
    ) -> BoxFuture<'a, Result<Vec<u8>, FetchError>> {
        Box::pin(async move {
            let work = async {
                let response = self.get(url).await?;
                if response
                    .content_length()
                    .is_some_and(|n| n > max_bytes as u64)
                {
                    return Err(FetchError("manifest response too large".to_owned()));
                }
                let mut body = Vec::new();
                let mut stream = response.bytes_stream();
                while let Some(chunk) = stream.next().await {
                    let chunk = chunk.map_err(|e| FetchError(e.without_url().to_string()))?;
                    if body.len() + chunk.len() > max_bytes {
                        return Err(FetchError("manifest response too large".to_owned()));
                    }
                    body.extend_from_slice(&chunk);
                }
                Ok(body)
            };
            tokio::time::timeout(MANIFEST_TIMEOUT, work)
                .await
                .map_err(|_| FetchError("manifest request timed out".to_owned()))?
        })
    }
}

impl PackageFetcher for HttpFetcher {
    fn fetch_to_file<'a>(
        &'a self,
        url: &'a Url,
        dest: &'a Path,
        max_bytes: u64,
        progress: ProgressFn,
    ) -> BoxFuture<'a, Result<(), FetchError>> {
        Box::pin(async move {
            let result = self.download(url, dest, max_bytes, &progress).await;
            if result.is_err() {
                let _ = tokio::fs::remove_file(dest).await;
            }
            result
        })
    }
}

impl HttpFetcher {
    async fn download(
        &self,
        url: &Url,
        dest: &Path,
        max_bytes: u64,
        progress: &ProgressFn,
    ) -> Result<(), FetchError> {
        let io = |e: std::io::Error| FetchError(e.to_string());
        let response = self.get(url).await?;
        let total = response.content_length();
        if total.is_some_and(|n| n > max_bytes) {
            return Err(FetchError(
                "package larger than the manifest allows".to_owned(),
            ));
        }
        if let Some(parent) = dest.parent().filter(|p| !p.as_os_str().is_empty()) {
            tokio::fs::create_dir_all(parent).await.map_err(io)?;
        }
        let mut file = tokio::fs::File::create(dest).await.map_err(io)?;
        let mut stream = response.bytes_stream();
        let mut received: u64 = 0;
        let mut last_percent = 0_u8;
        progress(0);
        while let Some(chunk) = stream.next().await {
            let chunk = chunk.map_err(|e| FetchError(e.without_url().to_string()))?;
            received += chunk.len() as u64;
            if received > max_bytes {
                return Err(FetchError(
                    "package larger than the manifest allows".to_owned(),
                ));
            }
            file.write_all(&chunk).await.map_err(io)?;
            if let Some(total) = total.filter(|t| *t > 0) {
                let percent =
                    u8::try_from((received.saturating_mul(100) / total).min(100)).unwrap_or(100);
                if percent != last_percent {
                    last_percent = percent;
                    progress(percent);
                }
            }
        }
        file.flush().await.map_err(io)?;
        file.sync_all().await.map_err(io)?;
        Ok(())
    }
}
