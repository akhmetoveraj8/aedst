//! Data layer: the wire mapping, the Connect repository and the outbox adapters.

pub mod connect_repository;
pub mod mapping;
pub mod outbox;

pub use connect_repository::ConnectTaskRepository;
pub use outbox::{KIND_CREATE, KIND_UPDATE, OutboxPendingWrites, register_handlers};
