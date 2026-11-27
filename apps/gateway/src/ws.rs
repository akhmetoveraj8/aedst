//! The HTTP surface: `GET /v1/ws` (WebSocket upgrade), `/livez` and `/readyz`.
//!
//! Server to client only in v1: frames the client sends are ignored (they only keep the socket
//! alive). Close codes: 4401 token expired, 4429 too slow, 1012 service restart (with a jittered
//! `reconnect_after_ms` hint in the reason), 4408 idle.
//!
//! Handshake contract. A client that can set headers sends `Authorization: Bearer <token>`. A
//! browser cannot, so it offers two subprotocols: `aedst.v1` and `aedst.bearer.<token>`. The
//! gateway answers with `aedst.v1` only: the token is never written to a response. A browser's
//! `Origin` must be on the allow-list (`AEDST_GATEWAY_ALLOWED_ORIGINS`); an empty list refuses
//! every browser.

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use axum::body::Bytes;
use axum::extract::State;
use axum::extract::ws::{CloseFrame, Message, WebSocket, WebSocketUpgrade};
use axum::http::{HeaderMap, StatusCode, header};
use axum::response::{IntoResponse, Response};
use axum::routing::get;
use tokio_util::sync::CancellationToken;

use crate::auth::{AuthError, Authenticator, Principal, now_secs};
use crate::config::Config;
use crate::consumer::{ConsumerHealth, ConsumerState};
use crate::hub::{Hub, HubError, Outbound, Registration};

/// The subprotocol the gateway speaks and the only one it ever selects.
pub const PROTOCOL: &str = "aedst.v1";
/// Subprotocol prefix browsers use to carry the token (they cannot set `Authorization` on a WebSocket).
pub const BEARER_PROTOCOL: &str = "aedst.bearer.";
/// Forwarded to the API unchanged (see `auth`).
const X_FORWARDED_FOR: &str = "x-forwarded-for";
/// Largest message accepted from a client (clients send nothing meaningful).
const MAX_CLIENT_MESSAGE: usize = 4096;
/// Longest a single write to a socket may take. A peer that stopped reading must not hold the task (and its
/// place in the per-user limit) until TCP gives up; the idle timer is not polled while a write is pending.
const WRITE_TIMEOUT: Duration = Duration::from_secs(10);

/// Shared state of the HTTP handlers.
pub struct AppState {
    /// Settings.
    pub cfg: Config,
    /// Asks the Go server who a client is (ADR-0026).
    pub auth: Authenticator,
    /// Live connections.
    pub hub: Arc<Hub>,
    /// State of the JetStream consumer.
    pub consumer: Arc<ConsumerHealth>,
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

/// 200 only while the consumer is attached and the process is not shutting down. The body names
/// the consumer state, its retries and the number of open sockets.
async fn readyz(State(st): State<Arc<AppState>>) -> (StatusCode, String) {
    let consumer = st.consumer.state();
    let ready = consumer == ConsumerState::Attached && !st.shutdown.is_cancelled();
    let status = if ready {
        StatusCode::OK
    } else {
        StatusCode::SERVICE_UNAVAILABLE
    };
    let body = format!(
        "consumer={} reconnects={} connections={}\n",
        consumer.as_str(),
        st.consumer.reconnects(),
        st.hub.len()
    );
    (status, body)
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

/// Every subprotocol the client offered.
fn offered(headers: &HeaderMap) -> impl Iterator<Item = &str> {
    headers
        .get_all(header::SEC_WEBSOCKET_PROTOCOL)
        .iter()
        .filter_map(|value| value.to_str().ok())
        .flat_map(|value| value.split(','))
        .map(str::trim)
}

/// The bearer token of the request: from `Authorization`, or from the `aedst.bearer.<token>`
/// subprotocol when the client also offers [`PROTOCOL`] (the name the gateway answers with).
fn bearer_from(headers: &HeaderMap) -> Result<String, StatusCode> {
    if let Some(value) = headers.get(header::AUTHORIZATION) {
        return value
            .to_str()
            .ok()
            .and_then(|value| value.split_once(' '))
            .filter(|(scheme, token)| scheme.eq_ignore_ascii_case("bearer") && !token.is_empty())
            .map(|(_, token)| token.trim().to_owned())
            .ok_or(StatusCode::UNAUTHORIZED);
    }
    let token = offered(headers)
        .find_map(|protocol| protocol.strip_prefix(BEARER_PROTOCOL))
        .filter(|token| !token.is_empty())
        .ok_or(StatusCode::UNAUTHORIZED)?;
    if !offered(headers).any(|protocol| protocol == PROTOCOL) {
        // Without it the gateway would have nothing to select but the token itself.
        return Err(StatusCode::BAD_REQUEST);
    }
    Ok(token.to_owned())
}

/// Browsers always send `Origin` on a WebSocket handshake; it must be on the allow-list. Other
/// clients send none and are authenticated by their token alone.
fn origin_allowed(cfg: &Config, headers: &HeaderMap) -> bool {
    let Some(origin) = headers.get(header::ORIGIN) else {
        return true;
    };
    if cfg.allow_any_origin {
        return true;
    }
    origin.to_str().is_ok_and(|origin| {
        cfg.allowed_origins
            .iter()
            .any(|allowed| allowed.eq_ignore_ascii_case(origin))
    })
}

async fn upgrade(
    State(st): State<Arc<AppState>>,
    headers: HeaderMap,
    ws: WebSocketUpgrade,
) -> Response {
    if !origin_allowed(&st.cfg, &headers) {
        return StatusCode::FORBIDDEN.into_response();
    }
    if st.shutdown.is_cancelled() {
        return StatusCode::SERVICE_UNAVAILABLE.into_response();
    }
    let token = match bearer_from(&headers) {
        Ok(token) => token,
        Err(status) => return status.into_response(),
    };
    let forwarded_for = headers
        .get(X_FORWARDED_FOR)
        .and_then(|value| value.to_str().ok());
    let principal = match st.auth.authenticate(&token, forwarded_for).await {
        Ok(principal) => principal,
        Err(AuthError::Throttled(reason)) => {
            tracing::info!(%reason, "websocket refused: too many failed authentications");
            return StatusCode::TOO_MANY_REQUESTS.into_response();
        }
        Err(AuthError::Unavailable(error)) => {
            tracing::error!(%error, "the api could not authenticate a websocket");
            return StatusCode::SERVICE_UNAVAILABLE.into_response();
        }
        Err(AuthError::Refused(reason)) => {
            tracing::info!(%reason, "websocket token refused");
            return StatusCode::UNAUTHORIZED.into_response();
        }
    };
    let registration = match st.hub.register(&principal.user_id) {
        Ok(registration) => registration,
        Err(HubError::TooMany) => return StatusCode::TOO_MANY_REQUESTS.into_response(),
        Err(HubError::Full) => return StatusCode::SERVICE_UNAVAILABLE.into_response(),
    };
    let guard = ConnGuard {
        hub: Arc::clone(&st.hub),
        user: principal.user_id.clone(),
        id: registration.id,
    };
    // Only the fixed name is ever selected, and only when the client offered it.
    ws.protocols([PROTOCOL])
        .max_message_size(MAX_CLIENT_MESSAGE)
        .max_frame_size(MAX_CLIENT_MESSAGE)
        .on_upgrade(move |socket| serve(socket, st, principal, registration, guard))
}

fn close(code: u16, reason: impl Into<String>) -> Message {
    let reason: String = reason.into();
    Message::Close(Some(CloseFrame {
        code,
        reason: reason.into(),
    }))
}

/// A restart hint spread over 0..5 s by connection id, so a deploy does not reconnect everyone at once.
fn restart_reason(id: u64) -> String {
    let jitter_ms = id.wrapping_mul(2_654_435_761) % 5000;
    format!("restart; reconnect_after_ms={jitter_ms}")
}

async fn serve(
    mut socket: WebSocket,
    st: Arc<AppState>,
    principal: Principal,
    mut reg: Registration,
    _guard: ConnGuard,
) {
    let until_expiry = Duration::from_secs(principal.expires_at.saturating_sub(now_secs()));
    let mut expiry = std::pin::pin!(tokio::time::sleep(until_expiry));
    let mut idle = std::pin::pin!(tokio::time::sleep(st.cfg.idle_timeout));
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
        let sent = tokio::time::timeout(WRITE_TIMEOUT, socket.send(message)).await;
        if !matches!(sent, Ok(Ok(()))) || closing {
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
            map.append(*k, v.parse().unwrap());
        }
        map
    }

    fn config(extra: &[(&str, &str)]) -> Config {
        let base = [
            ("AEDST_GATEWAY_API_URL", "http://localhost:8080"),
            ("AEDST_NATS_URL", "nats://localhost:4222"),
        ];
        Config::from_lookup(|key| {
            base.iter()
                .chain(extra)
                .find(|(k, _)| *k == key)
                .map(|(_, v)| (*v).to_owned())
        })
        .unwrap()
    }

    fn bearer(pairs: &[(&'static str, &str)]) -> Result<String, StatusCode> {
        bearer_from(&headers(pairs))
    }

    #[test]
    fn token_comes_from_the_header_or_the_subprotocol() {
        assert_eq!(bearer(&[("authorization", "Bearer abc")]), Ok("abc".into()));
        assert_eq!(
            bearer(&[("sec-websocket-protocol", "aedst.v1, aedst.bearer.tok.en")]),
            Ok("tok.en".into())
        );
        assert_eq!(
            bearer(&[
                ("sec-websocket-protocol", "aedst.bearer.tok"),
                ("sec-websocket-protocol", "aedst.v1"),
            ]),
            Ok("tok".into()),
            "protocols may arrive in separate header lines"
        );
        assert_eq!(
            bearer(&[("authorization", "Basic abc")]),
            Err(StatusCode::UNAUTHORIZED)
        );
        assert_eq!(bearer(&[]), Err(StatusCode::UNAUTHORIZED));
    }

    #[test]
    fn a_token_subprotocol_without_the_fixed_name_is_refused() {
        let alone = headers(&[("sec-websocket-protocol", "aedst.bearer.tok")]);
        assert_eq!(bearer_from(&alone), Err(StatusCode::BAD_REQUEST));
        let empty = headers(&[("sec-websocket-protocol", "aedst.v1, aedst.bearer.")]);
        assert_eq!(bearer_from(&empty), Err(StatusCode::UNAUTHORIZED));
    }

    #[test]
    fn the_selected_subprotocol_is_never_the_token() {
        assert!(!PROTOCOL.starts_with(BEARER_PROTOCOL));
        assert!(!BEARER_PROTOCOL.starts_with(PROTOCOL));
    }

    #[test]
    fn browsers_are_refused_unless_their_origin_is_listed() {
        let browser = headers(&[("origin", "https://app.example")]);
        let native = headers(&[]);

        let closed = config(&[]);
        assert!(
            !origin_allowed(&closed, &browser),
            "empty list fails closed"
        );
        assert!(origin_allowed(&closed, &native), "no Origin: not a browser");

        let listed = config(&[("AEDST_GATEWAY_ALLOWED_ORIGINS", "https://app.example")]);
        assert!(origin_allowed(&listed, &browser));
        let other = headers(&[("origin", "https://evil.example")]);
        assert!(!origin_allowed(&listed, &other));

        let development = config(&[("AEDST_GATEWAY_ALLOW_ANY_ORIGIN", "true")]);
        assert!(origin_allowed(&development, &other));
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
