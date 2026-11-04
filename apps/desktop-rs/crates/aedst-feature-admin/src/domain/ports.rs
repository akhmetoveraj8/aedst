//! What the domain needs from the outside world. `data` implements these; tests use fakes.

use aedst_common::ErrorKind;
use futures::future::BoxFuture;

use super::{
    model::{AdminTask, AuditEntry, Overview, Page, PageRequest},
    validation::BroadcastDraft,
};

/// The server side of Admin. Every call needs the `admin` role; a non-admin gets `Forbidden`.
/// Writes carry the `Idempotency-Key`. Nothing here is queued offline.
pub trait AdminRepository: Send + Sync {
    /// The counters.
    fn overview(&self) -> BoxFuture<'_, Result<Overview, ErrorKind>>;
    /// One page of tasks, optionally of one owner (`owner_id` is a UUID).
    fn list_tasks<'a>(
        &'a self,
        owner_id: Option<&'a str>,
        page: &'a PageRequest,
    ) -> BoxFuture<'a, Result<Page<AdminTask>, ErrorKind>>;
    /// Deletes a task; `reason` (3..=500 code points) goes to the audit log.
    fn delete_task<'a>(
        &'a self,
        id: &'a str,
        reason: &'a str,
        key: &'a str,
    ) -> BoxFuture<'a, Result<(), ErrorKind>>;
    /// Sends a system notification; returns the number of recipients.
    fn broadcast<'a>(
        &'a self,
        draft: &'a BroadcastDraft,
        key: &'a str,
    ) -> BoxFuture<'a, Result<u64, ErrorKind>>;
    /// One page of the audit log.
    fn list_audit_log<'a>(
        &'a self,
        page: &'a PageRequest,
    ) -> BoxFuture<'a, Result<Page<AuditEntry>, ErrorKind>>;
}

/// Whether the signed-in user holds the `admin` role (read from the identity token by the shell).
/// This is a convenience gate; the server enforces the role on every call.
pub trait AdminAccess: Send + Sync {
    /// True when the admin screen may load anything.
    fn is_admin(&self) -> bool;
}

/// A fixed answer (tests, the demo).
#[derive(Clone, Copy, Debug)]
pub struct StaticAccess(pub bool);

impl AdminAccess for StaticAccess {
    fn is_admin(&self) -> bool {
        self.0
    }
}
