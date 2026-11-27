//! Whether the API server is reachable, published on a `watch` channel.
//!
//! The operating system's "connected" flag says nothing about the one host the app talks to (a
//! captive portal, a VPN that is down, a firewall), so the monitor probes that host: a TCP connect to
//! the API host and port with a short timeout, often while offline and rarely while online. The
//! HTTP client does not use a proxy, so a direct connect is exactly what a request would need.
//! Repositories read [`Connectivity::is_online`] to report `offline` instead of `unavailable`; the
//! session scope delivers queued writes when the value turns back to online.

use std::{sync::Arc, time::Duration};

use tokio::{net::TcpStream, sync::watch, time::timeout};
use tokio_util::sync::CancellationToken;
use url::{Host, Url};

/// How long one probe may take.
const PROBE_TIMEOUT: Duration = Duration::from_secs(4);
/// Probe interval while the server is reachable.
const ONLINE_INTERVAL: Duration = Duration::from_secs(60);
/// Probe interval while it is not: coming back is noticed quickly.
const OFFLINE_INTERVAL: Duration = Duration::from_secs(10);

/// Reachability of the API server.
pub struct Connectivity {
    host: String,
    port: u16,
    online: watch::Sender<bool>,
}

impl Connectivity {
    /// A monitor for the host of `base` (already validated). It starts optimistic (online) so the
    /// first request is attempted before the first probe has finished.
    #[must_use]
    pub fn new(base: &Url) -> Arc<Self> {
        Arc::new(Self {
            // `host()`, not `host_str()`: an IPv6 literal must not keep its URL brackets.
            host: match base.host() {
                Some(Host::Domain(name)) => name.to_owned(),
                Some(Host::Ipv4(address)) => address.to_string(),
                Some(Host::Ipv6(address)) => address.to_string(),
                None => String::new(),
            },
            port: base.port_or_known_default().unwrap_or(443),
            online: watch::channel(true).0,
        })
    }

    /// The latest probe result.
    #[must_use]
    pub fn is_online(&self) -> bool {
        *self.online.borrow()
    }

    /// Changes of [`Self::is_online`].
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<bool> {
        self.online.subscribe()
    }

    /// One probe: can a TCP connection to the API host be opened?
    pub async fn probe(&self) -> bool {
        let attempt = timeout(
            PROBE_TIMEOUT,
            TcpStream::connect((self.host.as_str(), self.port)),
        )
        .await;
        matches!(attempt, Ok(Ok(_)))
    }

    /// Probes until `stop` is cancelled and publishes every change.
    pub async fn run(self: Arc<Self>, stop: CancellationToken) {
        loop {
            let online = self.probe().await;
            self.online.send_if_modified(|current| {
                let changed = *current != online;
                if changed {
                    tracing::info!(online, "API server reachability changed");
                }
                *current = online;
                changed
            });
            let wait = if online {
                ONLINE_INTERVAL
            } else {
                OFFLINE_INTERVAL
            };
            tokio::select! {
                () = stop.cancelled() => return,
                () = tokio::time::sleep(wait) => {}
            }
        }
    }

    /// A closure for the repositories' `online` parameter.
    #[must_use]
    pub fn reader(self: &Arc<Self>) -> impl Fn() -> bool + Clone + Send + Sync + 'static {
        let monitor = Arc::clone(self);
        move || monitor.is_online()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[tokio::test]
    async fn a_listening_host_is_online_and_a_closed_port_is_not() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        let open = Connectivity::new(&Url::parse(&format!("http://127.0.0.1:{port}")).unwrap());
        assert!(open.probe().await);

        drop(listener);
        let closed = Connectivity::new(&Url::parse(&format!("http://127.0.0.1:{port}")).unwrap());
        assert!(!closed.probe().await);
    }

    #[tokio::test]
    async fn run_publishes_the_change_and_stops_when_cancelled() {
        let listener = tokio::net::TcpListener::bind("127.0.0.1:0").await.unwrap();
        let port = listener.local_addr().unwrap().port();
        drop(listener);
        let monitor = Connectivity::new(&Url::parse(&format!("http://127.0.0.1:{port}")).unwrap());
        let mut changes = monitor.subscribe();
        let stop = CancellationToken::new();
        let task = tokio::spawn(Arc::clone(&monitor).run(stop.clone()));

        changes.changed().await.unwrap();
        assert!(!monitor.is_online());
        stop.cancel();
        task.await.unwrap();
    }
}
