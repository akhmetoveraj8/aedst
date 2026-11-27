//! Builds the signed self-update service from the configuration (split out of `services.rs`).

use std::sync::Arc;

use aedst_update::{
    FileUpdateStateStore, HttpFetcher, Installer, Ports, ReportOnlyInstaller, TrustedKeys,
    UpdateConfig, UpdateService, VelopackInstaller, system_clock,
};
use semver::Version;

use crate::config::AppConfig;

/// Largest manifest the client accepts.
const MAX_MANIFEST_BYTES: usize = 256 * 1024;

/// The self-update service, when it is configured and its keys parse. A broken configuration disables
/// updates (and is logged) instead of stopping the app.
#[must_use]
pub fn build_updates(config: &AppConfig) -> Option<Arc<UpdateService>> {
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
                max_manifest_bytes: MAX_MANIFEST_BYTES,
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
