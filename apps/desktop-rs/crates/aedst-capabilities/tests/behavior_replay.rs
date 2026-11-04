//! Replays `docs/contract/behavior/capabilities.json`, the fixture shared with every client.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

use aedst_capabilities::{ClientBuild, ServerCapabilities, ServerFeature, is_enabled};
use serde_json::Value;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../docs/contract/behavior/capabilities.json"
);

fn parse_server(value: &Value) -> Option<ServerCapabilities> {
    let features = value.get("features")?.as_object()?;
    Some(ServerCapabilities {
        features: features
            .iter()
            .map(|(name, f)| {
                (
                    name.clone(),
                    ServerFeature {
                        enabled: f["enabled"].as_bool().unwrap_or(false),
                        required_client_version: f
                            .get("requiredClientVersion")
                            .and_then(Value::as_str)
                            .map(String::from),
                    },
                )
            })
            .collect(),
        ..Default::default()
    })
}

#[test]
fn every_case_of_the_shared_fixture_passes() {
    let fixture: Value =
        serde_json::from_str(&std::fs::read_to_string(FIXTURE).expect("fixture")).unwrap();
    let spec = &fixture["clientBuild"];
    let strings = |key: &str| -> std::collections::HashSet<String> {
        spec[key]
            .as_array()
            .unwrap()
            .iter()
            .map(|v| v.as_str().unwrap().to_owned())
            .collect()
    };
    let build = ClientBuild {
        version: semver::Version::parse(spec["version"].as_str().unwrap()).ok(),
        features: strings("features"),
        flagged: strings("flagged"),
    };

    for case in fixture["cases"].as_array().unwrap() {
        let name = case["id"].as_str().unwrap();
        // The effective answer: the fetched one, else the last known (a failed fetch).
        let effective = parse_server(&case["server"]).or_else(|| parse_server(&case["lastKnown"]));
        for (feature, expected) in case["expect"].as_object().unwrap() {
            assert_eq!(
                is_enabled(&build, effective.as_ref(), feature),
                expected.as_bool().unwrap(),
                "{name}: {feature}"
            );
        }
    }
}
