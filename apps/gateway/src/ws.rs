//! The HTTP surface: `GET /v1/ws` (WebSocket upgrade), `/livez` and `/readyz`.
//!
//! Server to client only in v1: frames the client sends are ignored (they only keep the socket
//! alive). Close codes: 4401 token expired, 4429 too slow, 1012 service restart (with a jittered
//! `reconnect_after_ms` hint in the reason), 4408 idle.

use std::sync::Arc;
use std::sync::atomic::{AtomicBool, Ordering};
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tokio_util::sync::CancellationToken;

use crate::auth::{AuthError, Principal, Verifier, now_secs};
use crate::config::Config;
use crate::hub::{Hub, Outbound, Registration};

/// Subprotocol prefix browsers use to carry the token (they cannot set `Authorization` on a WebSocket).
const BEARER_PROTOCOL: &str = "aedst.bearer.";
/// Largest message accepted from a client (clients send nothing meaningful).
const MAX_CLIENT_MESSAGE: usize = 4096;

/// Shared state of the HTTP handlers.
pub struct AppState {
    /// Settings.
    pub cfg: Config,
    /// Token verifier.
    pub verifier: Verifier,
    /// Live connections.
    pub hub: Arc<Hub>,
    /// True while the JetStream consumer is attached.
    pub ready: Arc<AtomicBool>,
    /// Fires when the process is shutting down.
    pub shutdown: CancellationToken,
}

/// Builds the router.
pub fn router(state: Arc<AppState>) -> Router {
    Router::new()
        .route("/v1/ws", get(upgrade))
        .route("/livez", get(|| async { StatusCode::OK }))
        .route("/readyz", get(readyz))
        .with_state(state)
}

async fn readyz(State(st): State<Arc<AppState>>) -> StatusCode {
    if st.ready.load(Ordering::Relaxed) && !st.shutdown.is_cancelled() { StatusCode::OK } else { StatusCode::SERVICE_UNAVAILABLE }
}

/// Removes the connection from the hub however the task ends (also if the upgrade never completes).
struct ConnGuard {
    hub: Arc<Hub>,
    user: String,
    id: u64,
}

impl Drop for ConnGuard {
    fn drop(&mut self) {
        self.hub.unregister(&self.user, self.id);
    }
}

fn bearer_from(headers: &HeaderMap) -> Option<(String, bool)> {
    if let Some(value) = headers.get(header::AUTHORIZATION).and_then(|v| v.to_str().ok()) {
        let (scheme, token) = value.split_once(' ')?;
        return scheme.eq_ignore_ascii_case("bearer").then(|| (token.trim().to_owned(), false));
    }
    let protocols = headers.get(header::SEC_WEBSOCKET_PROTOCOL)?.to_str().ok()?;
    protocols
        .split(',')
        .map(str::trim)
        .find_map(|p| p.strip_prefix(BEARER_PROTOCOL))
        .map(|token| (token.to_owned(), true))
}

fn origin_allowed(cfg: &Config, headers: &HeaderMap) -> bool {
    if cfg.allowed_origins.is_empty() {
        return true;
    }
    match headers.get(header::ORIGIN).and_then(|v| v.to_str().ok()) {
        // Non-browser clients send no Origin; the token is what authenticates them.
        None => true,
        Some(origin) => cfg.allowed_origins.iter().any(|allowed| allowed == origin),
    }
}

async fn upgrade(State(st): State<Arc<AppState>>, headers: HeaderMap, ws: WebSocketUpgrade) -> Response {
    if !origin_allowed(&st.cfg, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if st.shutdown.is_cancelled() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let Some((token, via_protocol)) = bearer_from(&headers) else {
        return StatusCode::UNAUTHORIZED.into_response();
    };
    let principal = match st.verifier.verify(&token).await {
        Ok(principal) => principal,
        Err(AuthError::Keys(error)) => {
            tracing::error!(%error, "identity provider keys unavailable");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        Err(AuthError::Invalid(reason)) => {
            tracing::info!(%reason, "websocket token refused");
            return StatusCode::UNAUTHORIZED.into_response();
        }
    };
    let registration = match st.hub.register(&principal.user_id) {
        Ok(registration) => registration,
        Err(_) => return StatusCode::TOO_MANY_REQUESTS.into_response(),
    };
    let guard = ConnGuard { hub: Arc::clone(&st.hub), user: principal.user_id.clone(), id: registration.id };
    let ws = if via_protocol { ws.protocols([format!("{BEARER_PROTOCOL}{token}")]) } else { ws };
    ws.max_message_size(MAX_CLIENT_MESSAGE)
        .max_frame_size(MAX_CLIENT_MESSAGE)
        .on_upgrade(move |socket| serve(socket, st, principal, registration, guard))
}

fn close(code: u16, reason: impl Into<String>) -> Message {
    Message::Close(Some(CloseFrame { code, reason: reason.into().into() }))
}

/// A restart hint spread over 0..5 s by connection id, so a deploy does not reconnect everyone at once.
fn restart_reason(id: u64) -> String {
    let jitter_ms = id.wrapping_mul(2_654_435_761) % 5000;
    format!("restart; reconnect_after_ms={jitter_ms}")
}

async fn serve(mut socket: WebSocket, st: Arc<AppState>, principal: Principal, mut reg: Registration, _guard: ConnGuard) {
    let until_expiry = Duration::from_secs(principal.expires_at.saturating_sub(now_secs()));
    let expiry = tokio::time::sleep(until_expiry);
    let idle = tokio::time::sleep(st.cfg.idle_timeout);
    tokio::pin!(expiry, idle);
    let mut ping = tokio::time::interval(st.cfg.idle_timeout / 2);
    loop {
        let message = tokio::select! {
            out = reg.rx.recv() => match out {
                Some(Outbound::Frame(frame)) => Message::Text(frame.to_string().into()),
                Some(Outbound::Close(code, reason)) => close(code, reason),
                None => close(4429, "too slow"),
            },
            incoming = socket.recv() => match incoming {
                Some(Ok(Message::Close(_)) | Err(_)) | None => return,
                Some(Ok(_)) => {
                    idle.as_mut().reset(tokio::time::Instant::now() + st.cfg.idle_timeout);
                    continue;
                }
            },
            _ = ping.tick() => Message::Ping(Bytes::new()),
            () = &mut expiry => close(4401, "token expired"),
            () = &mut idle => close(4408, "idle"),
            () = st.shutdown.cancelled() => close(1012, restart_reason(reg.id)),
        };
        let closing = matches!(message, Message::Close(_));
        if socket.send(message).await.is_err() || closing {
            return;
        }
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn headers(pairs: &[(&'static str, &str)]) -> HeaderMap {
        let mut map = HeaderMap::new();
        for (k, v) in pairs {
            map.insert(*k, v.parse().unwrap());
        }
        map
    }

    #[test]
    fn token_comes_from_the_header_or_the_subprotocol() {
        assert_eq!(bearer_from(&headers(&[("authorization", "Bearer abc")])), Some(("abc".into(), false)));
        assert_eq!(bearer_from(&headers(&[("sec-websocket-protocol", "x, aedst.bearer.tok.en")])), Some(("tok.en".into(), true)));
        assert_eq!(bearer_from(&headers(&[("authorization", "Basic abc")])), None);
        assert_eq!(bearer_from(&headers(&[])), None);
    }

    #[test]
    fn restart_hint_is_bounded() {
        for id in [1, 2, 99, u64::MAX] {
            let reason = restart_reason(id);
            let ms: u64 = reason.rsplit('=').next().unwrap().parse().unwrap();
            assert!(ms < 5000, "{reason}");
        }
    }
}
