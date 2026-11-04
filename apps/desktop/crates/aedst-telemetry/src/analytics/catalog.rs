//! The event vocabulary: `docs/contract/analytics-events.json`, embedded at build time.
//!
//! A client emits only listed event names, and only the listed property keys with a value of the
//! documented type. Strings are short tokens (no free text); anything else is dropped.

use std::collections::HashMap;

use serde_json::{Map, Value};

use crate::scrub::scrub_pii;

const CONTRACT: &str = include_str!("../../../../../../docs/contract/analytics-events.json");
const PLATFORM: &str = "desktop";
const MAX_TOKEN_LEN: usize = 40;

#[derive(Clone, Debug, PartialEq, Eq)]
enum PropertyKind {
    Text,
    Number,
    Boolean,
    OneOf(Vec<String>),
}

impl PropertyKind {
    fn parse(spec: &str) -> Self {
        match spec.trim() {
            "string" => Self::Text,
            "number" => Self::Number,
            "boolean" => Self::Boolean,
            other => Self::OneOf(other.split('|').map(|v| v.trim().to_owned()).collect()),
        }
    }

    /// The value when it has the documented type and cannot carry free text.
    fn accept(&self, value: &Value) -> Option<Value> {
        match (self, value) {
            (Self::Boolean, Value::Bool(_)) => Some(value.clone()),
            (Self::Number, Value::Number(n)) if n.as_f64().is_some_and(f64::is_finite) => {
                Some(value.clone())
            }
            (Self::OneOf(allowed), Value::String(s)) if allowed.contains(s) => Some(value.clone()),
            (Self::Text, Value::String(s)) if is_short_token(s) => Some(value.clone()),
            _ => None,
        }
    }
}

/// `snake_case`, `kebab-case`, dotted or numeric identifiers; no spaces, so no sentences.
fn is_short_token(text: &str) -> bool {
    !text.is_empty()
        && text.len() <= MAX_TOKEN_LEN
        && text
            .bytes()
            .all(|b| b.is_ascii_alphanumeric() || matches!(b, b'_' | b'-' | b'.' | b':'))
        && scrub_pii(text) == text
}

/// The allowlist of events and their properties.
#[derive(Clone, Debug)]
pub struct EventCatalog {
    events: HashMap<String, HashMap<String, PropertyKind>>,
}

/// The contract file could not be read.
#[derive(Debug, thiserror::Error)]
#[error("invalid analytics contract: {0}")]
pub struct CatalogError(String);

impl EventCatalog {
    /// The events of the embedded contract that exist on desktop (empty, so nothing is sent, if
    /// the embedded file were malformed; a unit test checks it).
    #[must_use]
    pub fn desktop() -> Self {
        Self::from_contract(CONTRACT, PLATFORM).unwrap_or(Self {
            events: HashMap::new(),
        })
    }

    /// Reads a contract document, keeping the events listed for `platform`.
    ///
    /// # Errors
    /// The document is not the expected shape.
    pub fn from_contract(json: &str, platform: &str) -> Result<Self, CatalogError> {
        let root: Value = serde_json::from_str(json).map_err(|e| CatalogError(e.to_string()))?;
        let events = root
            .get("events")
            .and_then(Value::as_object)
            .ok_or_else(|| CatalogError("missing `events`".to_owned()))?;
        let mut catalog = HashMap::new();
        for (name, entry) in events {
            let on_platform = entry
                .get("platforms")
                .and_then(Value::as_array)
                .is_some_and(|list| list.iter().any(|p| p.as_str() == Some(platform)));
            if !on_platform {
                continue;
            }
            let properties = entry
                .get("properties")
                .and_then(Value::as_object)
                .map(|props| {
                    props
                        .iter()
                        .filter_map(|(k, v)| Some((k.clone(), PropertyKind::parse(v.as_str()?))))
                        .collect()
                })
                .unwrap_or_default();
            catalog.insert(name.clone(), properties);
        }
        Ok(Self { events: catalog })
    }

    /// Whether `event` may be sent from this platform.
    #[must_use]
    pub fn allows(&self, event: &str) -> bool {
        self.events.contains_key(event)
    }

    /// Number of events on this platform.
    #[must_use]
    pub fn len(&self) -> usize {
        self.events.len()
    }

    /// No events at all.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.events.is_empty()
    }

    /// The properties of `event` that are documented and well-typed; `None` for an unlisted event.
    #[must_use]
    pub fn sanitize(
        &self,
        event: &str,
        properties: &Map<String, Value>,
    ) -> Option<Map<String, Value>> {
        let allowed = self.events.get(event)?;
        Some(
            properties
                .iter()
                .filter_map(|(key, value)| {
                    let accepted = allowed.get(key)?.accept(value)?;
                    Some((key.clone(), accepted))
                })
                .collect(),
        )
    }
}
