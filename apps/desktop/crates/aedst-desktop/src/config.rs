//! Startup configuration from the environment. Issuer and client id are configuration, never
//! constants; there is no default API URL in a release build.

use std::path::PathBuf;

use aedst_oidc::OidcConfig;

/// Languages with a bundled catalog.
const LANGUAGES: [&str; 5] = ["en", "ru", "tg", "uz", "ar"];

/// Where and how this install updates itself. `None` of it means: no updates.
#[derive(Debug, Clone)]
pub struct UpdateSettings {
    /// https URL of the signed manifest envelope.
    pub manifest_url: String,
    /// https URL of the Velopack release feed (ignored in report-only mode).
    pub feed_url: String,
    /// Trusted keys `id:hex,id2:hex` (rotation = several).
    pub keys: String,
    /// `stable` or `beta`.
    pub channel: String,
    /// DEB, RPM, Flatpak: the package repository updates the app, the app only reports.
    pub report_only: bool,
}

/// Trusted update keys baked into the release build (`AEDST_UPDATE_KEYS=... cargo build --release`).
/// A debug build may override them from the environment; a release build never reads them from there.
const BUILT_IN_UPDATE_KEYS: Option<&str> = option_env!("AEDST_UPDATE_KEYS");

/// Everything the composition root needs to start.
#[derive(Debug)]
pub struct AppConfig {
    /// Base URL of the Connect API.
    pub api_url: String,
    /// `CARGO_PKG_VERSION`, sent as `X-Aedst-Client`.
    pub app_version: &'static str,
    /// Directory for the database and logs.
    pub data_dir: PathBuf,
    /// OIDC settings, `None` when issuer and client id are not both set.
    pub oidc: Option<OidcConfig>,
    /// One of the five bundled languages.
    pub language: &'static str,
    /// Sentry DSN; crash reports also need the user's consent.
    pub sentry_dsn: Option<String>,
    /// Self-update settings, `None` when the manifest URL, the feed URL or the keys are missing.
    pub update: Option<UpdateSettings>,
}

/// Why the app cannot start.
#[derive(Debug, thiserror::Error)]
pub enum ConfigError {
    /// A release build needs `AEDST_API_URL`.
    #[error("AEDST_API_URL is not set")]
    ApiUrlMissing,
    /// The platform has no per-user data directory.
    #[error("no per-user data directory on this platform")]
    NoDataDir,
}

fn non_empty(name: &str) -> Option<String> {
    std::env::var(name)
        .ok()
        .map(|v| v.trim().to_owned())
        .filter(|v| !v.is_empty())
}

fn update_settings() -> Option<UpdateSettings> {
    let report_only = non_empty("AEDST_UPDATE_MODE").as_deref() == Some("report");
    let keys = if cfg!(debug_assertions) {
        non_empty("AEDST_UPDATE_KEYS").or_else(|| BUILT_IN_UPDATE_KEYS.map(str::to_owned))
    } else {
        BUILT_IN_UPDATE_KEYS.map(str::to_owned)
    }?;
    let manifest_url = non_empty("AEDST_UPDATE_MANIFEST_URL")?;
    let feed_url =
        non_empty("AEDST_UPDATE_FEED_URL").or_else(|| report_only.then(|| manifest_url.clone()))?;
    Some(UpdateSettings {
        manifest_url,
        feed_url,
        keys,
        channel: non_empty("AEDST_UPDATE_CHANNEL").unwrap_or_else(|| "stable".to_owned()),
        report_only,
    })
}

/// Picks a bundled language: `AEDST_LANG`, else the OS locale, else English.
#[must_use]
pub fn choose_language(requested: Option<&str>, system: Option<&str>) -> &'static str {
    let base = |value: &str| {
        value
            .split(['-', '_', '.', '@'])
            .next()
            .unwrap_or_default()
            .to_ascii_lowercase()
    };
    // Windows reports Tajik as `tg`, some systems as `tj`.
    let normalise = |value: &str| match base(value).as_str() {
        "tj" => "tg".to_owned(),
        other => other.to_owned(),
    };
    [requested, system]
        .into_iter()
        .flatten()
        .map(normalise)
        .find_map(|code| LANGUAGES.into_iter().find(|l| *l == code))
        .unwrap_or("en")
}

impl AppConfig {
    /// Reads the environment.
    ///
    /// # Errors
    /// [`ConfigError`] when a required value is missing.
    pub fn from_env() -> Result<Self, ConfigError> {
        let api_url = match std::env::var("AEDST_API_URL")
            .ok()
            .filter(|v| !v.trim().is_empty())
        {
            Some(url) => url,
            None if cfg!(debug_assertions) => "http://127.0.0.1:8080".to_owned(),
            None => return Err(ConfigError::ApiUrlMissing),
        };
        let data_dir = dirs::data_dir()
            .ok_or(ConfigError::NoDataDir)?
            .join("AEDST");
        let requested = std::env::var("AEDST_LANG").ok();
        let system = sys_locale::get_locale();
        Ok(Self {
            api_url,
            app_version: env!("CARGO_PKG_VERSION"),
            data_dir,
            oidc: OidcConfig::from_env(),
            language: choose_language(requested.as_deref(), system.as_deref()),
            sentry_dsn: non_empty("AEDST_SENTRY_DSN"),
            update: update_settings(),
        })
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn the_requested_language_wins_over_the_system_one() {
        assert_eq!(choose_language(Some("ar"), Some("ru-RU")), "ar");
        assert_eq!(choose_language(None, Some("ru-RU")), "ru");
        assert_eq!(choose_language(None, Some("uz_UZ.UTF-8")), "uz");
    }

    #[test]
    fn tajik_is_tg_whichever_way_the_system_spells_it() {
        assert_eq!(choose_language(None, Some("tg-TJ")), "tg");
        assert_eq!(choose_language(None, Some("tj")), "tg");
    }

    #[test]
    fn unknown_or_missing_locales_fall_back_to_english() {
        assert_eq!(choose_language(Some("xx"), Some("de-DE")), "en");
        assert_eq!(choose_language(None, None), "en");
    }

    #[test]
    fn an_unsupported_request_still_lets_the_system_language_apply() {
        assert_eq!(choose_language(Some("xx"), Some("ru-RU")), "ru");
    }
}
