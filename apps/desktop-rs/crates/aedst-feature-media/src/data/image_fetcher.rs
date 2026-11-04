//! Downloads an image variant with `reqwest` (rustls). The body is read in chunks and the download
//! stops as soon as it exceeds the byte cap, whatever `Content-Length` claimed.
//!
//! Redirects: at most [`MAX_REDIRECTS`], only to the same scheme and only to URLs that pass the
//! transport policy; otherwise the 3xx answer is the result and fails. The URL appears in no
//! error and no log line.

use aedst_common::ErrorKind;
use futures::future::BoxFuture;
use reqwest::{
    header::{ACCEPT, CONTENT_LENGTH},
    redirect::Policy,
};

use super::{
    http::{CONNECT_TIMEOUT, kind_for_error, kind_for_status},
    url_policy::{MAX_REDIRECTS, check_transfer_url, redirect_allowed},
};
use crate::domain::{ImageFetcher, SecretUrl};

/// Formats the viewer can decode (no AVIF: it needs a decoder the workspace does not ship).
const ACCEPTED: &str = "image/webp,image/jpeg,image/png,image/gif;q=0.9";
const TIMEOUT: std::time::Duration = std::time::Duration::from_secs(60);

/// The `reqwest` implementation of [`ImageFetcher`].
#[derive(Clone)]
pub struct ReqwestImageFetcher {
    client: reqwest::Client,
}

impl ReqwestImageFetcher {
    /// A client with the connect and total timeouts and the redirect policy.
    ///
    /// # Errors
    /// [`ErrorKind::Unknown`] when the TLS backend cannot be set up.
    pub fn new() -> Result<Self, ErrorKind> {
        let policy = Policy::custom(|attempt| {
            let allowed = attempt.previous().len() < MAX_REDIRECTS
                && attempt
                    .previous()
                    .last()
                    .is_some_and(|from| redirect_allowed(from, attempt.url()));
            if allowed {
                attempt.follow()
            } else {
                attempt.stop()
            }
        });
        let client = reqwest::Client::builder()
            .redirect(policy)
            .connect_timeout(CONNECT_TIMEOUT)
            .timeout(TIMEOUT)
            .build()
            .map_err(|_| ErrorKind::Unknown)?;
        Ok(Self { client })
    }
}

impl ImageFetcher for ReqwestImageFetcher {
    fn fetch<'a>(
        &'a self,
        url: &'a SecretUrl,
        max_bytes: u64,
    ) -> BoxFuture<'a, Result<Vec<u8>, ErrorKind>> {
        Box::pin(async move {
            let url = check_transfer_url(url)?;
            let mut response = self
                .client
                .get(url)
                .header(ACCEPT, ACCEPTED)
                .send()
                .await
                .map_err(|e| kind_for_error(&e))?;
            let status = response.status();
            if !status.is_success() {
                tracing::warn!(status = status.as_u16(), "image download refused");
                return Err(kind_for_status(status.as_u16()));
            }
            let declared = response
                .headers()
                .get(CONTENT_LENGTH)
                .and_then(|v| v.to_str().ok())
                .and_then(|v| v.parse::<u64>().ok());
            if declared.is_some_and(|n| n > max_bytes) {
                return Err(ErrorKind::InvalidInput);
            }
            let mut bytes = Vec::new();
            while let Some(chunk) = response.chunk().await.map_err(|e| kind_for_error(&e))? {
                if bytes.len() as u64 + chunk.len() as u64 > max_bytes {
                    return Err(ErrorKind::InvalidInput);
                }
                bytes.extend_from_slice(&chunk);
            }
            Ok(bytes)
        })
    }
}
