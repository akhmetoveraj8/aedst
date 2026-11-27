//! The composition root of the APP scope: builds once, at start, everything that outlives a
//! sign-in (database, HTTP client, session, router, capabilities, outbox, telemetry, updates) and
//! the stateless feature services. The controllers of a signed-in user live in `session.rs`. No UI
//! types here; `flow.rs` and `main.rs` connect it to the window.

use std::{path::Path, sync::Arc, time::Duration};

use aedst_api::{TokenSource, client_config, validate_base_url};
use aedst_capabilities::{CapabilitiesService, ConnectCapabilitiesRemote};
use aedst_feature_admin::{
    data::ConnectAdminRepository,
    domain::{AdminAccess, AdminRepository},
};
use aedst_feature_media::{
    data::{ConnectMediaRepository, ReqwestImageFetcher, ReqwestUploader},
    domain::{FilePicker, ImageFetcher, MediaRepository, UploadService},
};
use aedst_feature_notifications::{
    data::ConnectNotificationsRepository, domain::NotificationsService,
};
use aedst_feature_search::{data::ConnectSearchRepository, domain::SearchService};
use aedst_feature_tasks::{
    data::{ConnectTaskRepository, OutboxPendingWrites, register_handlers},
    domain::{TaskRepository, TaskService},
};
use aedst_navigation::Router;
use aedst_oidc::{OidcSession, store::KeychainStore};
use aedst_outbox::{Handlers, OutboxService, SqliteOutbox};
use aedst_persistence::{Database, KvStore, Sealer};
use aedst_telemetry::{
    Analytics, AnalyticsSink, BufferedTransport, Consent, CrashConfig, CrashReporter, EventCatalog,
    KvConsentStore, crash::Environment,
};
use aedst_update::UpdateService;
use connectrpc::client::{ClientConfig, HttpClient};
use serde_json::{Map, Value};
use tokio::runtime::Handle;
use tokio_util::sync::CancellationToken;

use crate::{
    config::AppConfig,
    connectivity::Connectivity,
    data_key,
    features,
    links::{CapabilityAccess, NoFilePicker, RouterLinks},
    tls::http_client,
    updates::build_updates,
};

/// Flips to true together with the server's analytics ingest RPC and its adapter (decisions/desktop).
const ANALYTICS_INGEST_AVAILABLE: bool = false;
/// The safety-net interval for delivering queued writes (enqueues and reconnects trigger at once).
pub const OUTBOX_TICK: Duration = Duration::from_secs(60);
/// Key-value entry naming the account the queued writes belong to.
const OUTBOX_OWNER: &str = "outbox.owner";

/// Why the services could not be built.
#[derive(Debug, thiserror::Error)]
pub enum BuildError {
    /// A configuration, TLS or database problem, in words.
    #[error("{0}")]
    Setup(String),
}

fn setup(error: impl std::fmt::Display) -> BuildError {
    BuildError::Setup(error.to_string())
}

/// A fresh idempotency key.
#[must_use]
pub fn new_key() -> String {
    uuid::Uuid::new_v4().to_string()
}

/// The stateless feature services a session scope builds its controllers from.
pub struct FeatureDeps {
    pub tasks: Arc<TaskService>,
    pub search: Arc<SearchService>,
    pub links: Arc<RouterLinks>,
    pub notifications: Arc<NotificationsService>,
    pub media: Arc<dyn MediaRepository>,
    pub uploads: Arc<UploadService>,
    pub picker: Arc<dyn FilePicker>,
    pub images: Arc<dyn ImageFetcher>,
    pub admin: Arc<dyn AdminRepository>,
    pub admin_access: Arc<dyn AdminAccess>,
}

/// Everything of the app scope. Cheap to share.
pub struct Services {
    pub session: OidcSession,
    pub router: Arc<Router>,
    pub capabilities: Arc<CapabilitiesService>,
    pub connectivity: Arc<Connectivity>,
    pub outbox_queue: SqliteOutbox,
    pub outbox: Arc<OutboxService>,
    /// Sealed key-value store of the shell (the outbox owner).
    kv: KvStore,
    pub features: FeatureDeps,
    /// Crash reports and analytics are separate opt-ins, both off until the user says yes; the
    /// privacy screen reads and changes them.
    pub consent: Arc<Consent>,
    /// Signed self-update; `None` when the build or the environment does not configure it.
    pub updates: Option<Arc<UpdateService>>,
    /// Crash reports and analytics need a DSN / key in the build; the privacy screen says so.
    pub crash_available: bool,
    pub analytics_available: bool,
}

/// Feeds the Tasks feature's analytics port from the consent-gated sink. Only the event names and
/// properties of `docs/contract/analytics-events.json` are accepted by the sink; no free text.
struct TaskAnalytics(Arc<dyn AnalyticsSink>);

impl aedst_feature_tasks::domain::Analytics for TaskAnalytics {
    fn task_created(&self, priority: &'static str, has_due_date: bool) {
        let mut properties = Map::new();
        properties.insert("priority".to_owned(), Value::from(priority));
        properties.insert("has_due_date".to_owned(), Value::from(has_due_date));
        self.0.track("task_created", &properties);
    }

    fn task_completed(&self) {
        self.0.track("task_completed", &Map::new());
    }
}

/// Consent first (default off), then the crash reporter and the analytics sink that obey it.
fn telemetry(
    config: &AppConfig,
    kv: KvStore,
    runtime: &Handle,
) -> (Arc<Consent>, Arc<dyn AnalyticsSink>) {
    let consent = Arc::new(runtime.block_on(Consent::load(Box::new(KvConsentStore::new(kv)))));
    let crash = Arc::new(CrashReporter::new(
        CrashConfig {
            dsn: config.sentry_dsn.clone(),
            version: config.app_version.to_owned(),
            environment: Environment::for_version(
                config.app_version,
                std::env::var_os("CI").is_some(),
            ),
        },
        consent.subscribe(),
    ));
    if let Err(error) = crash.apply() {
        tracing::warn!(%error, "crash reporting is not configured");
    }
    runtime.spawn(Arc::clone(&crash).run());
    // The server has no analytics ingest endpoint yet, so events stay in a bounded in-memory queue
    // and `analytics_available` is false (the Privacy switch is disabled). See decisions/desktop.
    let sink = Arc::new(Analytics::new(
        EventCatalog::desktop(),
        &consent,
        Arc::new(BufferedTransport::default()),
    ));
    runtime.spawn(Arc::clone(&sink).run_install_id_sync(Arc::clone(&consent)));
    (consent, sink)
}

impl Services {
    /// Makes `subject` the owner of the queued writes: writes queued by another account (left by a
    /// crash before sign-out finished, or by an unknown owner) are dropped, never delivered under
    /// this account's token. Writes of the same account (an offline restart) are kept.
    pub async fn claim_outbox(&self, subject: &str) {
        if let Ok(Some(owner)) = self.kv.get(OUTBOX_OWNER).await
            && owner == subject.as_bytes()
        {
            return;
        }
        if !self.drop_outbox().await {
            return;
        }
        if let Err(error) = self.kv.set(OUTBOX_OWNER, subject.as_bytes()).await {
            tracing::warn!(%error, "could not record the owner of the queued writes");
        }
    }

    /// Drops every queued write; `false` (and logged) when the database refused.
    pub async fn drop_outbox(&self) -> bool {
        match self.outbox_queue.purge().await {
            Ok(()) => true,
            Err(error) => {
                tracing::warn!(%error, "could not purge the queued writes");
                false
            }
        }
    }

    /// Opens the database, builds the HTTP client and wires everything. Blocking (database, OS trust
    /// store, keychain, `Handle::block_on`): call it from `spawn_blocking`, never on the UI thread or
    /// a runtime worker (`main` does).
    ///
    /// # Errors
    /// [`BuildError`] for a bad API URL, missing TLS roots, a database that cannot be opened (or is
    /// newer than this build) or a missing OIDC configuration.
    pub fn build(config: &AppConfig, runtime: &Handle) -> Result<Self, BuildError> {
        let base = validate_base_url(&config.api_url).map_err(setup)?;
        let http: HttpClient = http_client(&base).map_err(setup)?;
        let api: ClientConfig =
            client_config(&config.api_url, config.app_version).map_err(setup)?;

        std::fs::create_dir_all(&config.data_dir).map_err(setup)?;
        let db = Database::open(&Path::new(&config.data_dir).join("aedst.db")).map_err(setup)?;
        // Every value the app keeps on disk is sealed with a key held in the OS keychain.
        let key = data_key::load_or_create_data_key(data_key::KEYCHAIN_SERVICE);
        if !key.persistent {
            tracing::warn!("no keychain: queued writes and settings will not survive a restart");
        }
        let sealer = Arc::new(Sealer::new(key.key));
        let kv = || KvStore::sealed(db.clone(), Arc::clone(&sealer));

        let (consent, analytics) = telemetry(config, kv(), runtime);

        let oidc = config
            .oidc
            .clone()
            .ok_or_else(|| setup("AEDST_OIDC_ISSUER / AEDST_OIDC_CLIENT_ID are not set"))?;
        let store = Arc::new(KeychainStore::new(oidc.store_key()));
        let session = OidcSession::new(oidc, store).map_err(setup)?;
        let tokens: Arc<dyn TokenSource> = Arc::new(session.clone());
        let connectivity = Connectivity::new(&base);
        // The monitor runs for the life of the app (the runtime ends it at exit).
        runtime.spawn(Arc::clone(&connectivity).run(CancellationToken::new()));
        let online = connectivity.reader();

        let router = Arc::new(Router::new(features::nav_graph()));
        let links = Arc::new(RouterLinks(Arc::clone(&router)));
        // Capabilities are anonymous (no token is sent): one client-wide answer, not a per-user one.
        let capabilities = CapabilitiesService::new(
            features::client_build(config.app_version),
            Arc::new(ConnectCapabilitiesRemote::new(http.clone(), api.clone())),
            kv(),
        );

        // Tasks, with the sealed offline outbox.
        let task_repo: Arc<dyn TaskRepository> = Arc::new(ConnectTaskRepository::new(
            http.clone(),
            api.clone(),
            Arc::clone(&tokens),
            online.clone(),
        ));
        let outbox_queue = SqliteOutbox::sealed(db.clone(), Arc::clone(&sealer));
        let mut handlers = Handlers::default();
        register_handlers(&mut handlers, &task_repo);
        let outbox = OutboxService::new(outbox_queue.clone(), handlers);
        let tasks = Arc::new(TaskService::new(
            task_repo,
            Arc::new(OutboxPendingWrites::new(outbox_queue.clone())),
            Arc::new(TaskAnalytics(analytics)),
            new_key,
        ));

        let search = Arc::new(SearchService::new(Arc::new(ConnectSearchRepository::new(
            http.clone(),
            api.clone(),
            Arc::clone(&tokens),
            online.clone(),
        ))));
        let notifications = Arc::new(NotificationsService::new(
            Arc::new(ConnectNotificationsRepository::new(
                http.clone(),
                api.clone(),
                Arc::clone(&tokens),
                online.clone(),
            )),
            links.clone(),
            new_key,
        ));

        // Media (no native file picker yet: the library lists and views, uploads cannot start).
        let media: Arc<dyn MediaRepository> = Arc::new(ConnectMediaRepository::new(
            http.clone(),
            api.clone(),
            Arc::clone(&tokens),
            online.clone(),
        ));
        let uploader = Arc::new(ReqwestUploader::new().map_err(|k| setup(k.name()))?);
        let uploads = Arc::new(UploadService::new(Arc::clone(&media), uploader));
        let images: Arc<dyn ImageFetcher> =
            Arc::new(ReqwestImageFetcher::new().map_err(|k| setup(k.name()))?);

        // Admin, offered when the server enables the capability.
        let admin: Arc<dyn AdminRepository> =
            Arc::new(ConnectAdminRepository::new(http, api, tokens, online));
        let admin_access: Arc<dyn AdminAccess> =
            Arc::new(CapabilityAccess(Arc::clone(&capabilities)));

        Ok(Self {
            session,
            router,
            capabilities,
            connectivity,
            outbox_queue,
            outbox,
            kv: kv(),
            features: FeatureDeps {
                tasks,
                search,
                links,
                notifications,
                media,
                uploads,
                picker: Arc::new(NoFilePicker),
                images,
                admin,
                admin_access,
            },
            consent,
            updates: build_updates(config),
            crash_available: config.sentry_dsn.is_some(),
            analytics_available: ANALYTICS_INGEST_AVAILABLE,
        })
    }
}
