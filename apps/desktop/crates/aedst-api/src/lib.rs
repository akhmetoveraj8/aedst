//! Calling the server: client configuration and authenticated calls.
//!
//! Generated clients come from `aedst-contract`; tokens come from `aedst-oidc`.

pub mod auth;
pub mod config;
pub mod error_kind;

pub use auth::{ApiError, TokenFailure, TokenSource, call_authenticated};
pub use config::{
    ConfigError, client_config, client_identifier, validate_base_url, with_idempotency_key,
};
pub use error_kind::kind_of;
