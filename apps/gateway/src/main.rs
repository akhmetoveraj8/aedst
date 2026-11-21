//! Process entry: configuration, NATS consumer, HTTP/WebSocket server, graceful shutdown.

use std::process::ExitCode;
use std::sync::Arc;
use std::time::Duration;

use aedst_gateway::auth::Verifier;
use aedst_gateway::config::Config;
use aedst_gateway::consumer::ConsumerHealth;
use aedst_gateway::hub::Hub;
use aedst_gateway::server::Limits;
use aedst_gateway::telemetry::Telemetry;
use aedst_gateway::{consumer, server, ws};
use tokio_util::sync::CancellationToken;

/// How often the shutdown path looks whether every socket has closed.
const DRAIN_POLL: Duration = Duration::from_millis(50);

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
    let listener = tokio::net::TcpListener::bind(cfg.addr)
        .await
        .map_err(|e| format!("bind {}: {e}", cfg.addr))?;
    tracing::info!(addr = %cfg.addr, "gateway listening");

    let hub = Arc::new(Hub::new(
        cfg.max_conns_per_user,
        cfg.max_conns,
        cfg.send_queue,
    ));
    let health = Arc::new(ConsumerHealth::default());
    let shutdown = CancellationToken::new();
    let consumer_task = tokio::spawn(consumer::run(
        cfg.nats_url.clone(),
        cfg.nats_stream.clone(),
        Arc::clone(&hub),
        Arc::clone(&health),
        shutdown.clone(),
    ));

    let grace = cfg.shutdown;
    let limits = Limits {
        header_timeout: cfg.header_timeout,
        max_handshakes: cfg.max_handshakes,
    };
    let state = Arc::new(ws::AppState {
        cfg,
        verifier,
        hub: Arc::clone(&hub),
        consumer: health,
        shutdown: shutdown.clone(),
    });

    // On SIGTERM/Ctrl-C: fail readiness, tell every socket to reconnect (1012 + jittered hint) and
    // stop accepting. The deadline bounds how long open sockets may delay the exit.
    let trigger = shutdown.clone();
    tokio::spawn(async move {
        wait_for_signal().await;
        trigger.cancel();
    });
    let work = async {
        server::serve(listener, ws::router(state), limits, shutdown.clone()).await;
        while !hub.is_empty() {
            tokio::time::sleep(DRAIN_POLL).await;
        }
    };
    let deadline = async {
        shutdown.cancelled().await;
        tokio::time::sleep(grace).await;
    };
    tokio::select! {
        () = work => {}
        () = deadline => {
            tracing::warn!("shutdown deadline reached; closing the remaining sockets");
            hub.close_all(1012, "restart");
        }
    }
    shutdown.cancel();
    let _ = consumer_task.await;
    Ok(())
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
