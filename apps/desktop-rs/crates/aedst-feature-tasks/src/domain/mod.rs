//! Domain layer: pure model, validation, ports and use cases. No wire types, no UI, no storage.

pub mod ports;
pub mod service;
pub mod task;
pub mod validation;

pub use ports::{Analytics, NoAnalytics, PendingWrites, TaskRepository};
pub use service::{CreateOutcome, SetDoneOutcome, TaskService};
pub use task::{LOCAL_PREFIX, PAGE_SIZE, Task, TaskPage, TaskPriority, TaskQuery, TaskStatus};
pub use validation::{MAX_DESCRIPTION, MAX_TITLE, NewTask, ValidationError};
