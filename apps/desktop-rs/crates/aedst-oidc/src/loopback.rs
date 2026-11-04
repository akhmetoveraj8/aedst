//! The loopback redirect receiver (RFC 8252 section 7.3): a listener on 127.0.0.1 or [::1] with an
//! OS-chosen port that waits for exactly one request to `/callback`.
//!
//! The first request to the callback path (accepted or rejected) ends the wait and closes the
//! listener, so a replayed callback finds a closed port. A rejected one fails the sign-in (fail
//! closed) instead of letting a forged callback inject a code. The response is a fixed `no-store`
//! page that never reflects request data.

use std::{net::SocketAddr, sync::Arc, time::Duration};

use tokio::{
    io::{AsyncReadExt, AsyncWriteExt},
    net::{TcpListener, TcpStream},
    sync::{Semaphore, mpsc},
    time::{Instant, timeout},
};
use tokio_util::sync::CancellationToken;

use crate::callback::{
    CALLBACK_PATH, CallbackError, Expectation, MAX_HEAD_BYTES, parse_callback, targets_callback,
};
use crate::error::OidcError;

const READ_DEADLINE: Duration = Duration::from_secs(5);
const MAX_CONNECTIONS: usize = 8;

const OK_PAGE: &str =
    "<!doctype html><meta charset=utf-8><title>AEDST</title><p>Signed in. You can close this tab.";
const FAIL_PAGE: &str =
    "<!doctype html><meta charset=utf-8><title>AEDST</title><p>Sign-in failed. Return to the app.";

/// A bound loopback listener.
#[derive(Debug)]
pub struct LoopbackListener {
    listener: TcpListener,
    addr: SocketAddr,
}

impl LoopbackListener {
    /// Binds 127.0.0.1, then [::1] when IPv4 loopback is unavailable. `port` of `None` lets the OS choose.
    ///
    /// # Errors
    /// [`OidcError::Unavailable`] when neither loopback address can be bound.
    pub async fn bind(port: Option<u16>) -> Result<Self, OidcError> {
        let port = port.unwrap_or(0);
        let mut last = None;
        for host in ["127.0.0.1", "::1"] {
            let candidate: SocketAddr = match host.parse() {
                Ok(ip) => SocketAddr::new(ip, port),
                Err(_) => continue,
            };
            match TcpListener::bind(candidate).await {
                Ok(listener) => {
                    let addr = listener
                        .local_addr()
                        .map_err(|e| OidcError::Unavailable(e.to_string()))?;
                    return Ok(Self { listener, addr });
                }
                Err(e) => last = Some(e),
            }
        }
        Err(OidcError::Unavailable(format!(
            "cannot bind a loopback port: {}",
            last.map_or_else(|| "unknown".into(), |e| e.to_string())
        )))
    }

    /// `ip:port` exactly as the browser puts it in the `Host` header.
    #[must_use]
    pub fn authority(&self) -> String {
        self.addr.to_string()
    }

    /// The redirect URI to register in the authorization request.
    #[must_use]
    pub fn redirect_uri(&self) -> String {
        format!("http://{}{CALLBACK_PATH}", self.addr)
    }

    /// Waits for the callback and returns the authorization code.
    ///
    /// # Errors
    /// [`OidcError::Cancelled`] (token cancelled or the user denied), [`OidcError::TimedOut`],
    /// [`OidcError::Security`] (forged or malformed callback), [`OidcError::Rejected`] (other provider errors).
    pub async fn wait_for_code(
        self,
        state: String,
        issuer: String,
        iss_required: bool,
        deadline: Duration,
        cancel: &CancellationToken,
    ) -> Result<String, OidcError> {
        let expect = Arc::new(Expectation {
            authority: self.authority(),
            state,
            issuer,
            iss_required,
        });
        let (tx, mut rx) = mpsc::channel::<Result<String, CallbackError>>(MAX_CONNECTIONS);
        let slots = Arc::new(Semaphore::new(MAX_CONNECTIONS));
        let end = Instant::now() + deadline;

        loop {
            tokio::select! {
                () = cancel.cancelled() => return Err(OidcError::Cancelled),
                () = tokio::time::sleep_until(end) => return Err(OidcError::TimedOut),
                Some(result) = rx.recv() => return result.map_err(into_oidc_error),
                accepted = self.listener.accept() => {
                    let Ok((stream, _)) = accepted else { continue };
                    let Ok(permit) = Arc::clone(&slots).try_acquire_owned() else { continue };
                    let (expect, tx) = (Arc::clone(&expect), tx.clone());
                    tokio::spawn(async move {
                        let _permit = permit;
                        if let Some(result) = serve_one(stream, &expect).await {
                            let _ = tx.send(result).await;
                        }
                    });
                }
            }
        }
    }
}

fn into_oidc_error(error: CallbackError) -> OidcError {
    match error {
        CallbackError::Provider(code) if code == "access_denied" => OidcError::Cancelled,
        CallbackError::Provider(code) => OidcError::Rejected(code),
        other => OidcError::Security(other.to_string()),
    }
}

/// Reads one request head. `Some(result)` only when the request targeted the callback path.
async fn serve_one(
    mut stream: TcpStream,
    expect: &Expectation,
) -> Option<Result<String, CallbackError>> {
    let head = timeout(READ_DEADLINE, read_head(&mut stream))
        .await
        .ok()
        .flatten()?;
    if !targets_callback(&head) {
        respond(&mut stream, "404 Not Found", FAIL_PAGE).await;
        return None;
    }
    let result = parse_callback(&head, expect);
    match &result {
        Ok(_) => respond(&mut stream, "200 OK", OK_PAGE).await,
        Err(_) => respond(&mut stream, "400 Bad Request", FAIL_PAGE).await,
    }
    Some(result)
}

async fn read_head(stream: &mut TcpStream) -> Option<String> {
    let mut buffer = Vec::with_capacity(512);
    let mut chunk = [0_u8; 512];
    while !buffer.windows(4).any(|w| w == b"\r\n\r\n") {
        let n = stream.read(&mut chunk).await.ok()?;
        if n == 0 || buffer.len() + n > MAX_HEAD_BYTES {
            return None;
        }
        buffer.extend_from_slice(&chunk[..n]);
    }
    String::from_utf8(buffer).ok()
}

async fn respond(stream: &mut TcpStream, status: &str, body: &str) {
    let response = format!(
        "HTTP/1.1 {status}\r\nContent-Type: text/html; charset=utf-8\r\nCache-Control: no-store\r\nConnection: close\r\nContent-Length: {}\r\n\r\n{body}",
        body.len()
    );
    let _ = stream.write_all(response.as_bytes()).await;
    let _ = stream.shutdown().await;
}

#[cfg(test)]
mod tests {
    use super::*;

    async fn send(authority: &str, request: &str) -> String {
        let mut stream = TcpStream::connect(authority).await.expect("connect");
        stream.write_all(request.as_bytes()).await.expect("write");
        let mut out = String::new();
        let _ = stream.read_to_string(&mut out).await;
        out
    }

    async fn wait(
        listener: LoopbackListener,
    ) -> (String, tokio::task::JoinHandle<Result<String, OidcError>>) {
        let authority = listener.authority();
        let cancel = CancellationToken::new();
        let handle = tokio::spawn(async move {
            listener
                .wait_for_code(
                    "st".into(),
                    "https://idp".into(),
                    false,
                    Duration::from_secs(5),
                    &cancel,
                )
                .await
        });
        (authority, handle)
    }

    #[tokio::test]
    async fn returns_the_code_and_closes_the_port() {
        let listener = LoopbackListener::bind(None).await.expect("bind");
        let (authority, handle) = wait(listener).await;
        let reply = send(
            &authority,
            &format!("GET /callback?code=C1&state=st HTTP/1.1\r\nHost: {authority}\r\n\r\n"),
        )
        .await;
        assert!(reply.starts_with("HTTP/1.1 200"), "{reply}");
        assert!(reply.contains("Cache-Control: no-store"));
        assert_eq!(handle.await.expect("join").expect("code"), "C1");
        assert!(
            TcpStream::connect(&authority).await.is_err(),
            "a replayed callback must find a closed port"
        );
    }

    #[tokio::test]
    async fn a_forged_callback_fails_the_sign_in() {
        let listener = LoopbackListener::bind(None).await.expect("bind");
        let (authority, handle) = wait(listener).await;
        let reply = send(
            &authority,
            &format!("GET /callback?code=EVIL&state=wrong HTTP/1.1\r\nHost: {authority}\r\n\r\n"),
        )
        .await;
        assert!(reply.starts_with("HTTP/1.1 400"), "{reply}");
        assert!(
            !reply.contains("EVIL"),
            "the page must not reflect request data"
        );
        assert!(matches!(
            handle.await.expect("join"),
            Err(OidcError::Security(_))
        ));
    }

    #[tokio::test]
    async fn other_paths_do_not_end_the_wait() {
        let listener = LoopbackListener::bind(None).await.expect("bind");
        let (authority, handle) = wait(listener).await;
        let reply = send(
            &authority,
            &format!("GET /favicon.ico HTTP/1.1\r\nHost: {authority}\r\n\r\n"),
        )
        .await;
        assert!(reply.starts_with("HTTP/1.1 404"), "{reply}");
        let _ = send(
            &authority,
            &format!("GET /callback?code=C2&state=st HTTP/1.1\r\nHost: {authority}\r\n\r\n"),
        )
        .await;
        assert_eq!(handle.await.expect("join").expect("code"), "C2");
    }

    #[tokio::test]
    async fn access_denied_is_a_cancellation() {
        let listener = LoopbackListener::bind(None).await.expect("bind");
        let (authority, handle) = wait(listener).await;
        let _ = send(
            &authority,
            &format!(
                "GET /callback?error=access_denied&state=st HTTP/1.1\r\nHost: {authority}\r\n\r\n"
            ),
        )
        .await;
        assert!(matches!(
            handle.await.expect("join"),
            Err(OidcError::Cancelled)
        ));
    }

    #[tokio::test]
    async fn cancelling_and_timing_out_end_the_wait() {
        let listener = LoopbackListener::bind(None).await.expect("bind");
        let cancel = CancellationToken::new();
        cancel.cancel();
        let result = listener
            .wait_for_code(
                "s".into(),
                "i".into(),
                false,
                Duration::from_secs(5),
                &cancel,
            )
            .await;
        assert!(matches!(result, Err(OidcError::Cancelled)));

        let listener = LoopbackListener::bind(None).await.expect("bind");
        let result = listener
            .wait_for_code(
                "s".into(),
                "i".into(),
                false,
                Duration::from_millis(50),
                &CancellationToken::new(),
            )
            .await;
        assert!(matches!(result, Err(OidcError::TimedOut)));
    }
}
