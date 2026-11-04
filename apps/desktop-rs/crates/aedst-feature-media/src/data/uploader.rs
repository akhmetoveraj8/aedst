//! Sends a file to a presigned URL with `reqwest` (rustls). The file is streamed in chunks from a
//! blocking thread, so a 500 MB video never sits in memory; progress is reported per chunk.
//!
//! Rules: the URL passes the transport policy; redirects are never followed (the body must not be
//! re-sent elsewhere); `Authorization` and other credential-looking headers from the server's
//! response are dropped; the URL appears in no error and no log line.

use std::{
    io::Read,
    path::PathBuf,
    sync::{
        Arc,
        atomic::{AtomicBool, Ordering},
    },
    time::Duration,
};

use aedst_common::ErrorKind;
use futures::future::BoxFuture;
use reqwest::{
    Method,
    header::{CONTENT_LENGTH, CONTENT_TYPE, HeaderMap, HeaderName, HeaderValue},
    redirect::Policy,
};

use super::{
    http::{CONNECT_TIMEOUT, kind_for_error, kind_for_status},
    url_policy::check_transfer_url,
};
use crate::domain::{ObjectUploader, OnBytes, PickedFile, UploadTarget};

const CHUNK: u64 = 256 * 1024;
/// A whole upload may take this long (a 500 MB video on a slow line).
const DEADLINE: Duration = Duration::from_secs(60 * 60);

/// Headers a server response may not make us send.
const FORBIDDEN_HEADERS: [&str; 7] = [
    "authorization",
    "cookie",
    "host",
    "content-length",
    "connection",
    "transfer-encoding",
    "proxy-authorization",
];

/// The `reqwest` implementation of [`ObjectUploader`].
#[derive(Clone)]
pub struct ReqwestUploader {
    client: reqwest::Client,
}

impl ReqwestUploader {
    /// A client with the connect timeout and no redirects.
    ///
    /// # Errors
    /// [`ErrorKind::Unknown`] when the TLS backend cannot be set up.
    pub fn new() -> Result<Self, ErrorKind> {
        let client = reqwest::Client::builder()
            .redirect(Policy::none())
            .connect_timeout(CONNECT_TIMEOUT)
            .build()
            .map_err(|_| ErrorKind::Unknown)?;
        Ok(Self { client })
    }
}

fn headers_for(
    target: &UploadTarget,
    content_type: &str,
    size: u64,
) -> Result<HeaderMap, ErrorKind> {
    let mut headers = HeaderMap::new();
    for (name, value) in &target.headers {
        if FORBIDDEN_HEADERS.contains(&name.to_ascii_lowercase().as_str()) {
            continue;
        }
        let name = HeaderName::from_bytes(name.as_bytes()).map_err(|_| ErrorKind::Unknown)?;
        let value = HeaderValue::from_str(value).map_err(|_| ErrorKind::Unknown)?;
        headers.insert(name, value);
    }
    if !headers.contains_key(CONTENT_TYPE) {
        let value = HeaderValue::from_str(content_type).map_err(|_| ErrorKind::Unknown)?;
        headers.insert(CONTENT_TYPE, value);
    }
    // Object stores reject chunked uploads: the length must be declared.
    headers.insert(CONTENT_LENGTH, HeaderValue::from(size));
    Ok(headers)
}

struct Reading {
    file: Option<std::fs::File>,
    path: PathBuf,
    sent: u64,
}

fn read_chunk(mut state: Reading, total: u64) -> std::io::Result<(Reading, Vec<u8>)> {
    if state.file.is_none() {
        state.file = Some(std::fs::File::open(&state.path)?);
    }
    let want = usize::try_from(CHUNK.min(total - state.sent)).unwrap_or(usize::MAX);
    let mut buffer = vec![0_u8; want];
    let mut filled = 0;
    if let Some(file) = state.file.as_mut() {
        while filled < want {
            let n = file.read(&mut buffer[filled..])?;
            if n == 0 {
                break;
            }
            filled += n;
        }
    }
    if filled == 0 {
        return Err(std::io::ErrorKind::UnexpectedEof.into()); // the file shrank
    }
    buffer.truncate(filled);
    state.sent += filled as u64;
    Ok((state, buffer))
}

fn file_body(
    path: PathBuf,
    total: u64,
    progress: OnBytes,
    read_failed: Arc<AtomicBool>,
) -> reqwest::Body {
    let start = Reading {
        file: None,
        path,
        sent: 0,
    };
    let stream = futures::stream::unfold(start, move |state| {
        let (progress, read_failed) = (Arc::clone(&progress), Arc::clone(&read_failed));
        async move {
            if state.sent >= total {
                return None;
            }
            let step = tokio::task::spawn_blocking(move || read_chunk(state, total))
                .await
                .unwrap_or_else(|_| Err(std::io::ErrorKind::Other.into()));
            match step {
                Ok((state, chunk)) => {
                    progress(state.sent, total);
                    Some((Ok(chunk), state))
                }
                Err(error) => {
                    read_failed.store(true, Ordering::SeqCst);
                    let end = Reading {
                        file: None,
                        path: PathBuf::new(),
                        sent: total,
                    };
                    Some((Err(error), end))
                }
            }
        }
    });
    reqwest::Body::wrap_stream(stream)
}

impl ObjectUploader for ReqwestUploader {
    fn upload<'a>(
        &'a self,
        target: &'a UploadTarget,
        file: &'a PickedFile,
        progress: OnBytes,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async move {
            let url = check_transfer_url(&target.url)?;
            let method = match target.method.to_ascii_uppercase().as_str() {
                "PUT" | "" => Method::PUT,
                "POST" => Method::POST,
                _ => return Err(ErrorKind::Unknown),
            };
            let headers = headers_for(target, &file.content_type, file.size)?;

            // The file must still be what the user picked, or the declared length would lie.
            let path = file.path.clone();
            let on_disk =
                tokio::task::spawn_blocking(move || std::fs::metadata(path).map(|m| m.len()))
                    .await
                    .map_err(|_| ErrorKind::Storage)?
                    .map_err(|_| ErrorKind::Storage)?;
            if on_disk != file.size {
                return Err(ErrorKind::Storage);
            }

            let read_failed = Arc::new(AtomicBool::new(false));
            let body = file_body(
                file.path.clone(),
                file.size,
                progress,
                Arc::clone(&read_failed),
            );
            let request = self
                .client
                .request(method, url)
                .headers(headers)
                .body(body)
                .send();
            let response = match tokio::time::timeout(DEADLINE, request).await {
                Err(_) => return Err(ErrorKind::Timeout),
                Ok(Err(error)) => {
                    return Err(if read_failed.load(Ordering::SeqCst) {
                        ErrorKind::Storage
                    } else {
                        kind_for_error(&error)
                    });
                }
                Ok(Ok(response)) => response,
            };
            let status = response.status();
            if status.is_success() {
                Ok(())
            } else {
                tracing::warn!(
                    status = status.as_u16(),
                    "media upload refused by object storage"
                );
                Err(kind_for_status(status.as_u16()))
            }
        })
    }
}
