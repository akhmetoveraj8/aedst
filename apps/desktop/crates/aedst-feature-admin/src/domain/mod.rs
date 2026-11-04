//! Domain layer: pure model, validation and ports. No wire types, no UI, no storage.

pub mod model;
pub mod ports;
pub mod validation;

pub use model::{AdminTask, AuditEntry, Overview, PAGE_SIZE, Page, PageRequest, TaskStatus};
pub use ports::{AdminAccess, AdminRepository, StaticAccess};
pub use validation::{
    BroadcastDraft, MAX_BODY, MAX_LINK, MAX_REASON, MAX_TITLE, MIN_REASON, ValidationError,
    parse_owner_filter, validate_reason,
};
