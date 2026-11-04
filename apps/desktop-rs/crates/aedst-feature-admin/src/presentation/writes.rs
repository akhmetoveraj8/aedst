//! The two writes of the screen: the two-step task delete and the broadcast. Neither is queued.

use aedst_common::ErrorKind;

use super::{
    controller::AdminController,
    state::{AdminView, BroadcastStatus, DeleteState, Phase, Section},
};
use crate::domain::{BroadcastDraft, validate_reason};

/// A shown list reloads the next time its tab opens, after a write changed what it would show.
fn stale<T>(section: &mut Section<T>) {
    if section.phase == Phase::Ready {
        section.phase = Phase::Idle;
    }
}

fn settled(view: &mut AdminView) {
    stale(&mut view.overview);
    stale(&mut view.audit);
}

impl AdminController {
    /// Step one of a delete: asks for the confirmation. Nothing is sent.
    pub async fn request_delete(&self, task_id: &str) {
        if !self.gate() {
            return;
        }
        self.update(|v| {
            if matches!(v.delete, DeleteState::Deleting { .. }) {
                return;
            }
            if let Some(task) = v.tasks.rows.iter().find(|t| t.id == task_id) {
                v.delete = DeleteState::Confirming {
                    id: task.id.clone(),
                    title: task.title.clone(),
                };
            }
        });
    }

    /// Leaves the confirmation without deleting.
    pub fn cancel_delete(&self) {
        self.update(|v| {
            if !matches!(v.delete, DeleteState::Deleting { .. }) {
                v.delete = DeleteState::Idle;
            }
        });
    }

    /// Step two: deletes the task of the open confirmation with `reason` (3..=500 code points,
    /// recorded in the audit log). Does nothing when no confirmation is open.
    pub async fn confirm_delete(&self, reason: &str) {
        if !self.gate() {
            return;
        }
        let target = self.update(|v| match &v.delete {
            DeleteState::Confirming { id, title }
            | DeleteState::Invalid { id, title, .. }
            | DeleteState::Failed { id, title, .. } => Some((id.clone(), title.clone())),
            DeleteState::Idle | DeleteState::Deleting { .. } => None,
        });
        let Some((id, title)) = target else {
            return;
        };
        let reason = match validate_reason(reason) {
            Ok(reason) => reason,
            Err(error) => {
                return self.update(|v| v.delete = DeleteState::Invalid { id, title, error });
            }
        };
        self.update(|v| {
            v.delete = DeleteState::Deleting {
                id: id.clone(),
                title: title.clone(),
            }
        });
        let key = (self.new_key)();
        let result = self.repo.delete_task(&id, &reason, &key).await;
        self.update(|v| match result {
            // Already gone counts as deleted: the operator's intent is met.
            Ok(()) | Err(ErrorKind::NotFound) => {
                v.tasks.rows.retain(|t| t.id != id);
                v.delete = DeleteState::Idle;
                settled(v);
            }
            Err(ErrorKind::Cancelled) => v.delete = DeleteState::Confirming { id, title },
            Err(ErrorKind::Forbidden) => Self::deny(v),
            Err(kind) => v.delete = DeleteState::Failed { id, title, kind },
        });
    }

    /// Validates and sends a system notification (`user_id` empty: everyone).
    pub async fn broadcast(&self, user_id: &str, title: &str, body: &str, link: &str) {
        if !self.gate() {
            return;
        }
        if self.update(|v| v.broadcast == BroadcastStatus::Sending) {
            return;
        }
        let draft = match BroadcastDraft::validate(user_id, title, body, link) {
            Ok(draft) => draft,
            Err(error) => return self.update(|v| v.broadcast = BroadcastStatus::Invalid(error)),
        };
        self.update(|v| v.broadcast = BroadcastStatus::Sending);
        let key = (self.new_key)();
        let result = self.repo.broadcast(&draft, &key).await;
        self.update(|v| match result {
            Ok(recipients) => {
                v.broadcast = BroadcastStatus::Sent { recipients };
                settled(v);
            }
            Err(ErrorKind::Cancelled) => v.broadcast = BroadcastStatus::Idle,
            Err(ErrorKind::Forbidden) => Self::deny(v),
            Err(kind) => v.broadcast = BroadcastStatus::Failed(kind),
        });
    }

    /// Hides the success or error line of the broadcast form (the operator started editing).
    pub fn clear_broadcast_status(&self) {
        self.update(|v| {
            if v.broadcast != BroadcastStatus::Sending {
                v.broadcast = BroadcastStatus::Idle;
            }
        });
    }
}
