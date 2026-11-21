//! The accept loop. `axum::serve` has no configuration, so the connections are served with
//! `hyper-util` directly (the documented route) to get two limits a public listener needs:
//!
//! - a header-read timeout: a client that opens a connection and sends its request slowly (or
//!   never) is dropped after `AEDST_GATEWAY_HEADER_TIMEOUT_SECONDS`;
//! - a cap on connections that are still in the HTTP phase (`AEDST_GATEWAY_MAX_HANDSHAKES`): when
//!   it is reached the listener stops accepting until one finishes.
//!
//! An upgraded connection leaves this loop (the socket task owns it), so open WebSockets are
//! counted by the hub instead (`AEDST_GATEWAY_MAX_CONNS`, `AEDST_GATEWAY_MAX_CONNS_PER_USER`).

use std::sync::Arc;
use std::time::Duration;

use axum::Router;
use hyper_util::rt::{TokioExecutor, TokioIo, TokioTimer};
use hyper_util::server::conn::auto::Builder;
use hyper_util::service::TowerToHyperService;
use tokio::net::TcpListener;
use tokio::sync::Semaphore;
use tokio::task::JoinSet;
use tokio_util::sync::CancellationToken;

/// Pause after a failed `accept` (for example, out of file descriptors) before trying again.
const ACCEPT_RETRY: Duration = Duration::from_millis(100);

/// Limits of the HTTP phase of a connection.
#[derive(Debug, Clone, Copy)]
pub struct Limits {
    /// Time a client has to send its request headers.
    pub header_timeout: Duration,
    /// Connections that may be in the HTTP phase at once.
    pub max_handshakes: usize,
}

/// Serves `app` on `listener` until `shutdown` fires, then stops accepting, lets requests in
/// flight finish and returns. Open WebSockets are not waited for here.
pub async fn serve(
    listener: TcpListener,
    app: Router,
    limits: Limits,
    shutdown: CancellationToken,
) {
    let mut builder = Builder::new(TokioExecutor::new());
    builder
        .http1()
        .timer(TokioTimer::new())
        .header_read_timeout(limits.header_timeout);
    let permits = Arc::new(Semaphore::new(limits.max_handshakes));
    let mut connections = JoinSet::new();
    loop {
        // Forget the connections that already finished.
        while connections.try_join_next().is_some() {}
        let permit = tokio::select! {
            () = shutdown.cancelled() => break,
            permit = Arc::clone(&permits).acquire_owned() => match permit {
                Ok(permit) => permit,
                Err(_) => break,
            },
        };
        let stream = tokio::select! {
            () = shutdown.cancelled() => break,
            accepted = listener.accept() => match accepted {
                Ok((stream, _peer)) => stream,
                Err(error) => {
                    tracing::warn!(%error, "accept failed");
                    tokio::time::sleep(ACCEPT_RETRY).await;
                    continue;
                }
            },
        };
        let service = TowerToHyperService::new(app.clone());
        let builder = builder.clone();
        let shutdown = shutdown.clone();
        connections.spawn(async move {
            let _permit = permit;
            let conn = builder.serve_connection_with_upgrades(TokioIo::new(stream), service);
            let mut conn = std::pin::pin!(conn);
            let result = tokio::select! {
                result = conn.as_mut() => result,
                () = shutdown.cancelled() => {
                    conn.as_mut().graceful_shutdown();
                    conn.as_mut().await
                }
            };
            if let Err(error) = result {
                tracing::debug!(%error, "connection ended with an error");
            }
        });
    }
    drop(listener);
    while connections.join_next().await.is_some() {}
}
