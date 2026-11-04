//! The composition root: builds every service and controller once and wires the ports of the
//! features to the core crates. No UI types here; `flow.rs` and `main.rs` connect it to the window.

use std::{path::Path, sync::Arc};

use aedst_api::{TokenSource, client_config, validate_base_url};
use aedst_capabilities::{CapabilitiesService, ClientBuild, ConnectCapabilitiesRemote};
use aedst_feature_admin::{
    data::ConnectAdminRepository, domain::AdminRepository, presentation::AdminController,
};
use aedst_feature_media::{
    data::{ConnectMediaRepository, ReqwestImageFetcher, ReqwestUploader},
    domain::{MediaRepository, UploadService},
    presentation::{LibraryController, ViewerController},
};
use aedst_feature_notifications::{
    data::ConnectNotificationsRepository,
    domain::NotificationsService,
    presentation::{InboxController, PreferencesController, UnreadCounter},
};
use aedst_feature_search::{
    data::ConnectSearchRepository, domain::SearchService, presentation::SearchController,
};
use aedst_feature_tasks::{
    data::{ConnectTaskRepository, OutboxPendingWrites, register_handlers},
    domain::{TaskRepository, TaskService},
    presentation::TaskListController,
};
use aedst_navigation::{NavGraph, Router, names};
use aedst_oidc::{OidcSession, store::KeychainStore};
use aedst_outbox::{Handlers, OutboxService, SqliteOutbox};
use aedst_persistence::Database;
use aedst_telemetry::{
    Analytics, AnalyticsSink, BufferedTransport, Consent, CrashConfig, CrashReporter, EventCatalog,
    KvConsentStore, crash::Environment,
};
use aedst_update::{
    FileUpdateStateStore, HttpFetcher, Installer, Ports, ReportOnlyInstaller, TrustedKeys,
    UpdateConfig, UpdateService, VelopackInstaller, system_clock,
};
use connectrpc::client::{ClientConfig, HttpClient};
use semver::Version;
use serde_json::{Map, Value};
use tokio::runtime::Handle;

use crate::{
    config::AppConfig,
    links::{CapabilityAccess, NoFilePicker, RouterLinks},
    tls::http_client,
};

/// Flips to true together with the server's analytics ingest RPC and its adapter (decisions/desktop).
const ANALYTICS_INGEST_AVAILABLE: bool = false;

/// Section id (the sidebar) -> route name.
pub const SECTIONS: [(&str, &str); 5] = [
    ("tasks", names::TASKS),
    ("search", names::SEARCH),
    ("notifications", names::NOTIFICATIONS),
    ("media", names::MEDIA),
    ("admin", names::ADMIN),
];

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

/// The three notification controllers (the shell builds the glue's own `Controllers` from them).
pub struct NotificationParts {
    pub inbox: Arc<InboxController>,
    pub preferences: Arc<PreferencesController>,
    pub unread: Arc<UnreadCounter>,
}

/// Everything the window needs. Cheap to share.
pub struct Services {
    pub session: OidcSession,
    pub router: Arc<Router>,
    pub capabilities: Arc<CapabilitiesService>,
    pub outbox_queue: SqliteOutbox,
    pub outbox: Arc<OutboxService>,
    pub tasks: Arc<TaskListController>,
    pub search: Arc<SearchController>,
    pub notifications: NotificationParts,
    pub media_library: Arc<LibraryController>,
    pub media_viewer: Arc<ViewerController>,
    pub admin: Arc<AdminController>,
    /// Crash reports and analytics are separate opt-ins, both off until the user says yes. The object
    /// owns the consent channel the reporters listen to, so it must live as long as the app; the
    /// privacy settings screen (not built yet) will read and change it.
    #[allow(dead_code)]
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

/// The self-update service, when it is configured and its keys parse. A broken configuration disables
/// updates (and is logged) instead of stopping the app.
fn build_updates(config: &AppConfig) -> Option<Arc<UpdateService>> {
    let settings = config.update.as_ref()?;
    let result = (|| -> Result<UpdateService, String> {
        let keys = TrustedKeys::parse(&settings.keys).map_err(|e| e.to_string())?;
        let fetcher = Arc::new(
            HttpFetcher::new(&format!("aedst-desktop/{}", config.app_version))
                .map_err(|e| e.to_string())?,
        );
        let installer: Arc<dyn Installer> = if settings.report_only {
            Arc::new(ReportOnlyInstaller)
        } else {
            Arc::new(VelopackInstaller::new(&settings.feed_url).map_err(|e| e.to_string())?)
        };
        let arch = match std::env::consts::ARCH {
            "aarch64" => "arm64",
            other => other,
        };
        Ok(UpdateService::new(
            UpdateConfig {
                manifest_url: settings.manifest_url.clone(),
                installed_version: Version::parse(config.app_version).map_err(|e| e.to_string())?,
                channel: settings.channel.clone(),
                platform: std::env::consts::OS.to_owned(),
                arch: arch.to_owned(),
                allow_downgrade: false,
                max_manifest_bytes: 256 * 1024,
                staging_dir: config.data_dir.join("updates"),
            },
            keys,
            Ports {
                manifests: fetcher.clone(),
                packages: fetcher,
                installer,
                store: Arc::new(FileUpdateStateStore::new(
                    config.data_dir.join("update-state.json"),
                )),
                clock: system_clock(),
            },
        ))
    })();
    match result {
        Ok(service) => Some(Arc::new(service)),
        Err(error) => {
            tracing::warn!(%error, "self-update is disabled: invalid configuration");
            None
        }
    }
}

fn nav_graph() -> NavGraph {
    let mut graph = NavGraph::default();
    graph.register(names::LOGIN, "login", &[]);
    graph.register(names::UPGRADE_REQUIRED, "upgrade", &[]);
    graph.register(names::TASKS, "tasks", &["tasks"]);
    graph.register(names::SEARCH, "search", &[]);
    graph.register(names::NOTIFICATIONS, "notifications", &["notifications"]);
    graph.register(names::MEDIA, "media", &["media"]);
    graph.register(names::ADMIN, "admin", &[]);
    graph
}

fn client_build(version: &str) -> ClientBuild {
    let set = |items: &[&str]| items.iter().map(|s| (*s).to_owned()).collect();
    ClientBuild {
        version: Version::parse(version).ok(),
        features: set(&["tasks", "media", "search", "admin", "notifications", "auth"]),
        flagged: set(&["admin"]),
    }
}

fn new_key() -> String {
    uuid::Uuid::new_v4().to_string()
}

impl Services {
    /// Opens the database, builds the HTTP client and wires everything.
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

        // Telemetry: consent first (default off), then the sinks that obey it.
        let consent = Arc::new(runtime.block_on(Consent::load(Box::new(KvConsentStore::new(
            aedst_persistence::KvStore::new(db.clone()),
        )))));
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
        let analytics: Arc<dyn AnalyticsSink> = {
            let sink = Arc::new(Analytics::new(
                EventCatalog::desktop(),
                &consent,
                Arc::new(BufferedTransport::default()),
            ));
            runtime.spawn(Arc::clone(&sink).run_install_id_sync(Arc::clone(&consent)));
            sink
        };

        let oidc = config
            .oidc
            .clone()
            .ok_or_else(|| setup("AEDST_OIDC_ISSUER / AEDST_OIDC_CLIENT_ID are not set"))?;
        let store = Arc::new(KeychainStore::new(oidc.store_key()));
        let session = OidcSession::new(oidc, store).map_err(setup)?;
        let tokens: Arc<dyn TokenSource> = Arc::new(session.clone());
        // No connectivity monitor yet: every request is attempted, failures are classified by kind.
        let online = || true;

        let router = Arc::new(Router::new(nav_graph()));
        let links = Arc::new(RouterLinks(Arc::clone(&router)));

        let capabilities = CapabilitiesService::new(
            client_build(config.app_version),
            Arc::new(ConnectCapabilitiesRemote::new(http.clone(), api.clone())),
            aedst_persistence::KvStore::new(db.clone()),
        );

        // Tasks, with the offline outbox.
        let task_repo: Arc<dyn TaskRepository> = Arc::new(ConnectTaskRepository::new(
            http.clone(),
            api.clone(),
            Arc::clone(&tokens),
            online,
        ));
        let outbox_queue = SqliteOutbox::new(db.clone());
        let mut handlers = Handlers::default();
        register_handlers(&mut handlers, &task_repo);
        let outbox = OutboxService::new(outbox_queue.clone(), handlers);
        let task_service = Arc::new(TaskService::new(
            task_repo,
            Arc::new(OutboxPendingWrites::new(outbox_queue.clone())),
            Arc::new(TaskAnalytics(analytics)),
            new_key,
        ));
        let tasks = TaskListController::new(task_service);

        // Search.
        let search_repo = Arc::new(ConnectSearchRepository::new(
            http.clone(),
            api.clone(),
            Arc::clone(&tokens),
            online,
        ));
        let search =
            SearchController::new(Arc::new(SearchService::new(search_repo)), links.clone());

        // Notifications.
        let notification_repo = Arc::new(ConnectNotificationsRepository::new(
            http.clone(),
            api.clone(),
            Arc::clone(&tokens),
            online,
        ));
        let notification_service =
            Arc::new(NotificationsService::new(notification_repo, links, new_key));
        let unread = UnreadCounter::new(Arc::clone(&notification_service));
        let notifications = NotificationParts {
            inbox: InboxController::new(Arc::clone(&notification_service), Arc::clone(&unread)),
            preferences: PreferencesController::new(notification_service),
            unread,
        };

        // Media (no native file picker yet: the library lists and views, uploads cannot start).
        let media_repo: Arc<dyn MediaRepository> = Arc::new(ConnectMediaRepository::new(
            http.clone(),
            api.clone(),
            Arc::clone(&tokens),
            online,
        ));
        let uploader = Arc::new(ReqwestUploader::new().map_err(|k| setup(k.name()))?);
        let fetcher = Arc::new(ReqwestImageFetcher::new().map_err(|k| setup(k.name()))?);
        let media_library = LibraryController::new(
            Arc::clone(&media_repo),
            Arc::new(UploadService::new(media_repo, uploader)),
            Arc::new(NoFilePicker),
        );
        let media_viewer = ViewerController::new(fetcher);

        // Admin, offered when the server enables the capability.
        let admin_repo: Arc<dyn AdminRepository> =
            Arc::new(ConnectAdminRepository::new(http, api, tokens, online));
        let admin = AdminController::new(
            admin_repo,
            Arc::new(CapabilityAccess(Arc::clone(&capabilities))),
            new_key,
        );

        let updates = build_updates(config);
        Ok(Self {
            session,
            router,
            capabilities,
            outbox_queue,
            outbox,
            tasks,
            search,
            notifications,
            media_library,
            media_viewer,
            admin,
            consent,
            updates,
            crash_available: config.sentry_dsn.is_some(),
            analytics_available: ANALYTICS_INGEST_AVAILABLE,
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn every_section_has_a_registered_route() {
        let graph = nav_graph();
        for (section, route) in SECTIONS {
            assert!(graph.resolve(route).is_some(), "{section} -> {route}");
        }
    }

    #[test]
    fn the_client_build_flags_only_admin() {
        let build = client_build("1.2.3");
        assert_eq!(build.flagged.len(), 1);
        assert!(build.flagged.contains("admin"));
        assert!(build.version.is_some());
    }
}
