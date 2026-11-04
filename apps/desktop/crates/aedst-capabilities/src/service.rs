//! Fetches the capabilities, caches the last answer and announces changes.
//!
//! Source order: a fetched answer, else the last known (cache), else the defaults. A failed fetch
//! never clears anything; a cache read that finishes after a fetch is ignored; one fetch at a time.
//! The network and the cache are ports so tests use doubles.

use std::sync::{Arc, Mutex, PoisonError};

use aedst_contract::proto::aedst::capabilities::v1::{
    CapabilitiesServiceClient, GetCapabilitiesRequest, GetCapabilitiesResponse, UpdateStatus,
};
use aedst_persistence::KvStore;
use connectrpc::client::{ClientConfig, HttpClient};
use futures::future::BoxFuture;
use tokio::sync::{Mutex as AsyncMutex, watch};

use crate::rules::{
    ClientBuild, ServerCapabilities, ServerFeature, VersionAdvice, advise_version, is_enabled,
};

const CACHE_KEY: &str = "capabilities.v1";
/// The platform key in the server's `clients` map.
const PLATFORM: &str = "desktop";

/// Where the answer comes from.
pub trait CapabilitiesRemote: Send + Sync + 'static {
    /// Calls `GetCapabilities` (public, idempotent).
    fn fetch(&self) -> BoxFuture<'_, Result<GetCapabilitiesResponse, String>>;
}

/// The real network source.
pub struct ConnectCapabilitiesRemote {
    client: CapabilitiesServiceClient<HttpClient>,
}

impl ConnectCapabilitiesRemote {
    /// `config` carries the base URL and the client identifier header.
    #[must_use]
    pub fn new(http: HttpClient, config: ClientConfig) -> Self {
        Self {
            client: CapabilitiesServiceClient::new(http, config),
        }
    }
}

impl CapabilitiesRemote for ConnectCapabilitiesRemote {
    fn fetch(&self) -> BoxFuture<'_, Result<GetCapabilitiesResponse, String>> {
        Box::pin(async move {
            let response = self
                .client
                .get_capabilities(GetCapabilitiesRequest::default())
                .await
                .map_err(|e| e.to_string())?;
            Ok(response.into_owned())
        })
    }
}

/// Reduces the wire message to what the rules use.
#[must_use]
pub fn convert(response: &GetCapabilitiesResponse) -> ServerCapabilities {
    let window = response.clients.get(PLATFORM);
    let non_empty = |s: &str| (!s.is_empty()).then(|| s.to_owned());
    ServerCapabilities {
        features: response
            .features
            .iter()
            .map(|(name, f)| {
                (
                    name.clone(),
                    ServerFeature {
                        enabled: f.enabled,
                        required_client_version: non_empty(&f.required_client_version),
                    },
                )
            })
            .collect(),
        minimum_client: window.and_then(|w| non_empty(&w.minimum)),
        recommended_client: window.and_then(|w| non_empty(&w.recommended)),
        update_recommended: response.update_status
            == buffa::EnumValue::Known(UpdateStatus::UPDATE_STATUS_RECOMMENDED),
    }
}

#[derive(Default)]
struct State {
    server: Option<ServerCapabilities>,
    fetched: bool,
}

/// Capability negotiation for one signed-in or signed-out client.
pub struct CapabilitiesService {
    build: ClientBuild,
    remote: Arc<dyn CapabilitiesRemote>,
    cache: KvStore,
    state: Mutex<State>,
    fetching: AsyncMutex<()>,
    changed: watch::Sender<u64>,
}

impl CapabilitiesService {
    /// A service for `build`.
    #[must_use]
    pub fn new(
        build: ClientBuild,
        remote: Arc<dyn CapabilitiesRemote>,
        cache: KvStore,
    ) -> Arc<Self> {
        Arc::new(Self {
            build,
            remote,
            cache,
            state: Mutex::new(State::default()),
            fetching: AsyncMutex::new(()),
            changed: watch::channel(0).0,
        })
    }

    /// Reads the cache, then fetches. Call once the first screen is on its way.
    pub async fn start(&self) {
        self.load_cache().await;
        self.refresh().await;
    }

    /// Fetches again (at launch and whenever connectivity returns). Skipped when one is in flight.
    pub async fn refresh(&self) {
        let Ok(_guard) = self.fetching.try_lock() else {
            return;
        };
        match self.remote.fetch().await {
            Ok(response) => {
                if let Ok(bytes) = serde_json::to_vec(&response)
                    && let Err(error) = self.cache.set(CACHE_KEY, &bytes).await
                {
                    tracing::warn!(%error, "could not cache capabilities");
                }
                self.apply(convert(&response), true);
            }
            Err(error) => {
                tracing::info!(%error, "capabilities fetch failed; keeping the last known answer")
            }
        }
    }

    async fn load_cache(&self) {
        let cached = match self.cache.get(CACHE_KEY).await {
            Ok(Some(bytes)) => serde_json::from_slice::<GetCapabilitiesResponse>(&bytes).ok(),
            Ok(None) => None,
            Err(error) => {
                tracing::warn!(%error, "could not read the capabilities cache");
                None
            }
        };
        if let Some(response) = cached {
            self.apply(convert(&response), false); // an unreadable entry is ignored
        }
    }

    fn apply(&self, server: ServerCapabilities, fetched: bool) {
        {
            let mut state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
            if !fetched && state.fetched {
                return; // a cache read that finished after a fetch must not overwrite it
            }
            state.fetched |= fetched;
            state.server = Some(server);
        }
        self.changed.send_modify(|generation| *generation += 1);
    }

    /// Whether the feature (or sub-capability) is shown. Defaults apply until an answer exists.
    #[must_use]
    pub fn is_enabled(&self, name: &str) -> bool {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        is_enabled(&self.build, state.server.as_ref(), name)
    }

    /// What to do about the client's own version, from the effective answer.
    #[must_use]
    pub fn advice(&self) -> VersionAdvice {
        let state = self.state.lock().unwrap_or_else(PoisonError::into_inner);
        state
            .server
            .as_ref()
            .map_or(VersionAdvice::Current, |s| advise_version(&self.build, s))
    }

    /// Fires whenever the effective answer changes; the shell re-reads `is_enabled`.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<u64> {
        self.changed.subscribe()
    }
}

#[cfg(test)]
mod tests {
    use std::sync::atomic::{AtomicUsize, Ordering};

    use aedst_contract::proto::aedst::capabilities::v1::Feature;
    use aedst_persistence::Database;

    use super::*;

    struct Fake {
        answers: Mutex<Vec<Result<GetCapabilitiesResponse, String>>>,
        calls: AtomicUsize,
    }

    impl CapabilitiesRemote for Fake {
        fn fetch(&self) -> BoxFuture<'_, Result<GetCapabilitiesResponse, String>> {
            self.calls.fetch_add(1, Ordering::SeqCst);
            let next = self.answers.lock().unwrap().remove(0);
            Box::pin(async move { next })
        }
    }

    fn answer(name: &str, enabled: bool) -> GetCapabilitiesResponse {
        let mut r = GetCapabilitiesResponse::default();
        r.features.insert(
            name.into(),
            Feature {
                enabled,
                ..Default::default()
            },
        );
        r
    }

    fn build() -> ClientBuild {
        ClientBuild {
            version: semver::Version::parse("1.3.0").ok(),
            features: ["tasks", "search"].map(String::from).into(),
            flagged: Default::default(),
        }
    }

    fn service(
        answers: Vec<Result<GetCapabilitiesResponse, String>>,
        db: &Database,
    ) -> (Arc<CapabilitiesService>, Arc<Fake>) {
        let fake = Arc::new(Fake {
            answers: Mutex::new(answers),
            calls: AtomicUsize::new(0),
        });
        (
            CapabilitiesService::new(build(), fake.clone(), KvStore::new(db.clone())),
            fake,
        )
    }

    #[tokio::test]
    async fn defaults_until_an_answer_then_the_server_wins_and_listeners_hear_about_it() {
        let db = Database::open_in_memory().unwrap();
        let (svc, _) = service(vec![Ok(answer("search", false))], &db);
        assert!(
            svc.is_enabled("search"),
            "built-in default before any answer"
        );
        let rx = svc.subscribe();
        svc.start().await;
        assert!(!svc.is_enabled("search"));
        assert!(rx.has_changed().unwrap());
    }

    #[tokio::test]
    async fn a_failed_fetch_keeps_the_cached_answer_across_restarts() {
        let db = Database::open_in_memory().unwrap();
        let (first, _) = service(vec![Ok(answer("search", false))], &db);
        first.start().await;

        let (second, fake) = service(vec![Err("offline".into())], &db);
        second.start().await;

        assert_eq!(fake.calls.load(Ordering::SeqCst), 1);
        assert!(
            !second.is_enabled("search"),
            "last known answer survived the failed fetch"
        );
    }

    #[tokio::test]
    async fn an_unreadable_cache_entry_is_ignored() {
        let db = Database::open_in_memory().unwrap();
        KvStore::new(db.clone())
            .set(CACHE_KEY, b"{not json")
            .await
            .unwrap();
        let (svc, _) = service(vec![Err("offline".into())], &db);
        svc.start().await;
        assert!(svc.is_enabled("search"));
    }

    #[tokio::test]
    async fn the_minimum_version_asks_for_an_upgrade() {
        let db = Database::open_in_memory().unwrap();
        let mut response = answer("tasks", true);
        response.clients.insert(
            "desktop".into(),
            aedst_contract::proto::aedst::capabilities::v1::ClientVersions {
                minimum: "2.0.0".into(),
                ..Default::default()
            },
        );
        let (svc, _) = service(vec![Ok(response)], &db);
        svc.start().await;
        assert_eq!(svc.advice(), VersionAdvice::UpgradeRequired);
    }
}
