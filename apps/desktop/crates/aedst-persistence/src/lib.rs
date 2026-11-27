//! Local SQLite storage: one database thread, central migrations, a key-value table, and the
//! AES-256-GCM [`Sealer`] that encrypts stored values at rest.
//!
//! The outbox table is created here (its schema is part of the one migration list) and used by
//! `aedst-outbox`.

pub mod database;
pub mod error;
pub mod kv;
pub mod migrations;
pub mod seal;

pub use database::Database;
pub use error::PersistenceError;
pub use kv::KvStore;
pub use seal::{DataKey, KEY_LEN, Sealer};
