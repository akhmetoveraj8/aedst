//! The one table of the composed features. The sidebar sections, the routes, the capability flags
//! and the client build sent to the server are all derived from [`FEATURES`]; adding a feature means
//! a row here, its id in `feature_ids.rs`, its controllers in `session.rs` and its view in
//! `shell.slint` (Slint has no run-time composition).

use std::collections::HashSet;

use aedst_capabilities::ClientBuild;
use aedst_navigation::{NavGraph, names};
use semver::Version;

use crate::generated::{ShellScreen, ShellSection};

/// What the shell knows about one feature.
#[derive(Clone, Copy, Debug)]
pub struct FeatureSpec {
    /// The coarse feature id (`aedst-feature-<id>`, the server's capability id).
    pub id: &'static str,
    /// The sidebar section that shows it.
    pub section: ShellSection,
    /// The route that opens it.
    pub route: &'static str,
    /// In-app link prefixes the route accepts.
    pub link_prefixes: &'static [&'static str],
    /// Off until the server enables the capability of the same id.
    pub flagged: bool,
}

/// Every feature, in sidebar order (the same order as `feature_ids.rs`, checked by a test).
pub const FEATURES: [FeatureSpec; 5] = [
    FeatureSpec {
        id: "tasks",
        section: ShellSection::Tasks,
        route: names::TASKS,
        link_prefixes: &["tasks"],
        flagged: false,
    },
    FeatureSpec {
        id: "search",
        section: ShellSection::Search,
        route: names::SEARCH,
        link_prefixes: &[],
        flagged: false,
    },
    FeatureSpec {
        id: "notifications",
        section: ShellSection::Notifications,
        route: names::NOTIFICATIONS,
        link_prefixes: &["notifications"],
        flagged: false,
    },
    FeatureSpec {
        id: "media",
        section: ShellSection::Media,
        route: names::MEDIA,
        link_prefixes: &["media"],
        flagged: false,
    },
    FeatureSpec {
        id: "admin",
        section: ShellSection::Admin,
        route: names::ADMIN,
        link_prefixes: &[],
        flagged: true,
    },
];

/// The feature shown first after sign-in.
pub const HOME: FeatureSpec = FEATURES[0];

/// The feature a sidebar section shows (`None` for the privacy screen, which is part of the shell).
#[must_use]
pub fn by_section(section: ShellSection) -> Option<&'static FeatureSpec> {
    FEATURES.iter().find(|f| f.section == section)
}

/// Screen and sidebar section for a route name. An unknown route falls back to the home section.
#[must_use]
pub fn screen_for(route: &str) -> (ShellScreen, ShellSection) {
    match route {
        names::LOGIN => (ShellScreen::Login, HOME.section),
        names::UPGRADE_REQUIRED => (ShellScreen::Upgrade, HOME.section),
        other => (
            ShellScreen::App,
            FEATURES
                .iter()
                .find(|f| f.route == other)
                .map_or(HOME.section, |f| f.section),
        ),
    }
}

/// The navigation graph: the two shell screens plus one route per feature.
#[must_use]
pub fn nav_graph() -> NavGraph {
    let mut graph = NavGraph::default();
    graph.register(names::LOGIN, "login", &[]);
    graph.register(names::UPGRADE_REQUIRED, "upgrade", &[]);
    for feature in &FEATURES {
        graph.register(feature.route, feature.id, feature.link_prefixes);
    }
    graph
}

/// What this build tells the capabilities service it contains.
#[must_use]
pub fn client_build(version: &str) -> ClientBuild {
    let mut features: HashSet<String> = FEATURES.iter().map(|f| f.id.to_owned()).collect();
    features.insert("auth".to_owned());
    ClientBuild {
        version: Version::parse(version).ok(),
        features,
        flagged: FEATURES
            .iter()
            .filter(|f| f.flagged)
            .map(|f| f.id.to_owned())
            .collect(),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    // The list `build.rs` merges the catalogs of; the table must name the same features.
    include!("feature_ids.rs");

    #[test]
    fn the_table_matches_the_list_the_build_script_merges() {
        let ids: Vec<&str> = FEATURES.iter().map(|f| f.id).collect();
        assert_eq!(ids, FEATURE_IDS);
    }

    #[test]
    fn every_feature_has_a_registered_route_and_its_own_section() {
        let graph = nav_graph();
        let mut sections = HashSet::new();
        for feature in &FEATURES {
            assert!(graph.resolve(feature.route).is_some(), "{}", feature.id);
            assert!(sections.insert(format!("{:?}", feature.section)), "{}", feature.id);
            assert_eq!(by_section(feature.section).map(|f| f.id), Some(feature.id));
        }
        assert!(by_section(ShellSection::Privacy).is_none());
    }

    #[test]
    fn routes_map_to_screens_and_sections() {
        assert_eq!(screen_for(names::LOGIN).0, ShellScreen::Login);
        assert_eq!(screen_for(names::UPGRADE_REQUIRED).0, ShellScreen::Upgrade);
        assert_eq!(
            screen_for(names::MEDIA),
            (ShellScreen::App, ShellSection::Media)
        );
        assert_eq!(
            screen_for("tasks/detail"),
            (ShellScreen::App, ShellSection::Tasks),
            "an unknown route falls back to the home section"
        );
    }

    #[test]
    fn the_client_build_flags_only_admin() {
        let build = client_build("1.2.3");
        assert_eq!(build.flagged, HashSet::from(["admin".to_owned()]));
        assert!(build.features.contains("auth"));
        assert!(build.version.is_some());
    }
}
