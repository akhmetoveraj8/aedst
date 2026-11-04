//! OIDC sign-in for the desktop app (Authorization Code + PKCE, RFC 8252 loopback redirect).
//!
//! The protocol work (PKCE, code exchange, ID-token signature and nonce checks, refresh,
//! revocation) is done by the `openidconnect` crate. Custom code is limited to the loopback
//! receiver and the callback judge, the keychain wiring and the single-flight session.

pub mod callback;
pub mod config;
pub mod error;
pub mod loopback;
pub mod provider;
pub mod session;
pub mod signin;
pub mod store;

pub use config::OidcConfig;
pub use error::OidcError;
pub use session::{AccessToken, OidcSession, Revocation, SignOut};
pub use signin::{BrowserOpener, SystemBrowser};
