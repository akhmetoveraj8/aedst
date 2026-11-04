//! Capability negotiation (ADR-0035 of the Qt app, ported): which features this client shows.

pub mod rules;
pub mod service;

pub use rules::{
    ClientBuild, ServerCapabilities, ServerFeature, VersionAdvice, advise_version, is_enabled,
};
pub use service::{CapabilitiesRemote, CapabilitiesService, ConnectCapabilitiesRemote, convert};
