//! Local SQLite storage: one database thread, central migrations, a key-value table.
//!
//! The outbox table is created here (its schema is part of the one migration list) and used by
//! `aedst-outbox`.

pub mod database;
pub mod error;
pub mod kv;
pub mod migrations;

pub use database::Database;
pub use error::PersistenceError;
pub use kv::KvStore;
