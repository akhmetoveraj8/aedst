//! Process entry: configuration, NATS consumer, HTTP/WebSocket server, graceful shutdown.

use std::process::ExitCode;
use std::sync::Arc;
use std::sync::atomic::AtomicBool;

use aedst_gateway::auth::Verifier;
use aedst_gateway::config::Config;
use aedst_gateway::hub::Hub;
use aedst_gateway::telemetry::Telemetry;
use aedst_gateway::{consumer, ws};
use tokio_util::sync::CancellationToken;

#[tokio::main]
async fn main() -> ExitCode {
    let telemetry = Telemetry::init();
    let code = match run().await {
        Ok(()) => ExitCode::SUCCESS,
        Err(error) => {
            tracing::error!(%error, "gateway stopped");
            ExitCode::FAILURE
        }
    };
    telemetry.shutdown();
    code
}

async fn run() -> Result<(), String> {
    let cfg = Config::from_env().map_err(|e| e.to_string())?;
    let verifier = Verifier::new(cfg.oidc.clone()).map_err(|e| e.to_string())?;
    let hub = Arc::new(Hub::new(cfg.max_conns_per_user, cfg.send_queue));
    let ready = Arc::new(AtomicBool::new(false));
    let shutdown = CancellationToken::new();

    let consumer_task = tokio::spawn(consumer::run(
        cfg.nats_url.clone(),
        cfg.nats_stream.clone(),
        Arc::clone(&hub),
        Arc::clone(&ready),
        shutdown.clone(),
    ));

    let listener = tokio::net::TcpListener::bind(cfg.addr).await.map_err(|e| format!("bind {}: {e}", cfg.addr))?;
    tracing::info!(addr = %cfg.addr, "gateway listening");
    let grace = cfg.shutdown;
    let state = Arc::new(ws::AppState { cfg, verifier, hub: Arc::clone(&hub), ready, shutdown: shutdown.clone() });

    // On SIGTERM/Ctrl-C: fail readiness, tell every socket to reconnect (1012 + jittered hint), then
    // stop accepting; the deadline bounds how long open sockets may delay the exit.
    let trigger = shutdown.clone();
    let server = axum::serve(listener, ws::router(state)).with_graceful_shutdown(async move {
        wait_for_signal().await;
        trigger.cancel();
    });
    let server = std::pin::pin!(std::future::IntoFuture::into_future(server));
    let outcome = tokio::select! {
        result = server => result.map_err(|e| e.to_string()),
        () = async {
            shutdown.cancelled().await;
            tokio::time::sleep(grace).await;
        } => {
            tracing::warn!("shutdown deadline reached; exiting with sockets still open");
            hub.close_all(1012, "restart");
            Ok(())
        }
    };
    shutdown.cancel();
    let _ = consumer_task.await;
    outcome
}

async fn wait_for_signal() {
    #[cfg(unix)]
    {
        use tokio::signal::unix::{SignalKind, signal};
        if let Ok(mut term) = signal(SignalKind::terminate()) {
            tokio::select! {
                _ = term.recv() => {}
                _ = tokio::signal::ctrl_c() => {}
            }
            return;
        }
    }
    let _ = tokio::signal::ctrl_c().await;
}
