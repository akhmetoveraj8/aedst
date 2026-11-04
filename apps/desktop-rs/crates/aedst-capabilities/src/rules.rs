//! The visibility rules as a pure function (identical to `docs/contract/behavior/capabilities.json`
//! and to the other clients).
//!
//! A feature is shown iff the build contains it AND the server enables it. `enabled = false`
//! always wins. `required_client_version` hides it on an older client; an unparsable requirement,
//! or an unknown client version with a requirement, hides it (fail closed). A feature the server
//! does not list falls back to the default (built-in on, flagged off). Server names the build does
//! not contain are ignored. Dotted names (`media.uploads`) are sub-capabilities: shown iff the
//! server enables them, the client meets their requirement and their coarse parent is shown.

use std::collections::{HashMap, HashSet};

use semver::Version;

/// What this build of the client contains.
#[derive(Clone, Debug, Default)]
pub struct ClientBuild {
    /// The app version, `None` when it is not semver.
    pub version: Option<Version>,
    /// Coarse feature ids compiled in (`tasks`, `media`, ...).
    pub features: HashSet<String>,
    /// Built-in features that stay off until the server enables them.
    pub flagged: HashSet<String>,
}

/// One server-side feature switch.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ServerFeature {
    /// The server turns the feature on.
    pub enabled: bool,
    /// The oldest client that may show it.
    pub required_client_version: Option<String>,
}

/// The server's answer, reduced to what the rules need.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct ServerCapabilities {
    /// Feature switches by name.
    pub features: HashMap<String, ServerFeature>,
    /// Oldest client the server still accepts for this platform.
    pub minimum_client: Option<String>,
    /// Client version the server would like users to run.
    pub recommended_client: Option<String>,
    /// The server itself says an update is recommended.
    pub update_recommended: bool,
}

/// What the client should do about its own version.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum VersionAdvice {
    /// Nothing to say.
    Current,
    /// Show a non-blocking prompt.
    Recommended,
    /// Lock the app to the upgrade screen.
    UpgradeRequired,
}

fn meets(build: &ClientBuild, requirement: Option<&str>) -> bool {
    match requirement.filter(|r| !r.is_empty()) {
        None => true,
        Some(required) => match (Version::parse(required), &build.version) {
            (Ok(required), Some(own)) => *own >= required,
            _ => false, // unparsable requirement or unknown client version: fail closed
        },
    }
}

/// Whether `name` is shown. `server` is the effective answer: the fetched one, else the last known.
#[must_use]
pub fn is_enabled(build: &ClientBuild, server: Option<&ServerCapabilities>, name: &str) -> bool {
    let parent = name.split('.').next().unwrap_or(name);
    if !build.features.contains(parent) {
        return false;
    }
    let listed = server.and_then(|s| s.features.get(name));
    if name.contains('.') {
        let own =
            listed.is_some_and(|f| f.enabled && meets(build, f.required_client_version.as_deref()));
        return own && is_enabled(build, server, parent);
    }
    match listed {
        Some(feature) => {
            feature.enabled && meets(build, feature.required_client_version.as_deref())
        }
        None => !build.flagged.contains(name),
    }
}

/// Compares the client version with the server's window. An unparsable bound is ignored.
#[must_use]
pub fn advise_version(build: &ClientBuild, server: &ServerCapabilities) -> VersionAdvice {
    let Some(own) = &build.version else {
        return VersionAdvice::Current;
    };
    let below = |bound: &Option<String>| {
        bound
            .as_deref()
            .and_then(|b| Version::parse(b).ok())
            .is_some_and(|b| *own < b)
    };
    if below(&server.minimum_client) {
        VersionAdvice::UpgradeRequired
    } else if server.update_recommended || below(&server.recommended_client) {
        VersionAdvice::Recommended
    } else {
        VersionAdvice::Current
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn build() -> ClientBuild {
        ClientBuild {
            version: Version::parse("1.3.0").ok(),
            features: ["tasks", "media", "search"].map(String::from).into(),
            flagged: ["media"].map(String::from).into(),
        }
    }

    fn server(entries: &[(&str, bool, Option<&str>)]) -> ServerCapabilities {
        ServerCapabilities {
            features: entries
                .iter()
                .map(|(n, e, r)| {
                    (
                        (*n).to_owned(),
                        ServerFeature {
                            enabled: *e,
                            required_client_version: r.map(String::from),
                        },
                    )
                })
                .collect(),
            ..Default::default()
        }
    }

    #[test]
    fn sub_capability_needs_its_parent_and_the_server() {
        let s = server(&[("media", true, None), ("media.uploads", true, None)]);
        assert!(is_enabled(&build(), Some(&s), "media.uploads"));
        let parent_off = server(&[("media", false, None), ("media.uploads", true, None)]);
        assert!(!is_enabled(&build(), Some(&parent_off), "media.uploads"));
        assert!(
            !is_enabled(&build(), None, "media.uploads"),
            "never fetched: sub-capabilities are off"
        );
    }

    #[test]
    fn unparsable_requirement_and_unknown_client_version_fail_closed() {
        let s = server(&[("tasks", true, Some("not-a-version"))]);
        assert!(!is_enabled(&build(), Some(&s), "tasks"));
        let mut unknown = build();
        unknown.version = None;
        let s = server(&[("tasks", true, Some("1.0.0"))]);
        assert!(!is_enabled(&unknown, Some(&s), "tasks"));
    }

    #[test]
    fn version_window() {
        let mut s = ServerCapabilities {
            minimum_client: Some("1.4.0".into()),
            ..Default::default()
        };
        assert_eq!(advise_version(&build(), &s), VersionAdvice::UpgradeRequired);
        s.minimum_client = Some("1.0.0".into());
        s.recommended_client = Some("1.5.0".into());
        assert_eq!(advise_version(&build(), &s), VersionAdvice::Recommended);
        s.recommended_client = Some("garbage".into());
        assert_eq!(advise_version(&build(), &s), VersionAdvice::Current);
        s.update_recommended = true;
        assert_eq!(advise_version(&build(), &s), VersionAdvice::Recommended);
    }
}
