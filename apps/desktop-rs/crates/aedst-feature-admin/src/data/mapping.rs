//! Wire <-> domain. The only file that knows both the generated types and the domain model.

use aedst_contract::proto::aedst::admin::v1 as wire;
use buffa::MessageField;
use buffa_types::google::protobuf::Timestamp;

use crate::domain::{
    AdminTask, AuditEntry, BroadcastDraft, Overview, PAGE_SIZE, Page, PageRequest, TaskStatus,
};

fn seconds(ts: &MessageField<Timestamp, buffa::Inline<Timestamp>>) -> i64 {
    ts.as_option().map_or(0, |t| t.seconds)
}

fn token(next: &str) -> Option<String> {
    Some(next.to_owned()).filter(|t| !t.is_empty())
}

fn page_size() -> i32 {
    i32::try_from(PAGE_SIZE).unwrap_or(25)
}

/// The counters. Negative numbers (never expected) clamp to zero.
#[must_use]
pub fn overview_from_wire(r: &wire::GetOverviewResponse) -> Overview {
    let n = |v: i64| v.max(0);
    Overview {
        tasks_total: n(r.tasks_total),
        tasks_done: n(r.tasks_done),
        tasks_overdue: n(r.tasks_overdue),
        media_total: n(r.media_total),
        media_bytes: n(r.media_bytes),
        push_devices: n(r.push_devices),
        job_lag_seconds: n(r.outbox_lag_seconds),
        jobs_pending: n(r.jobs_pending),
    }
}

/// A task page. The status number is mapped, never trusted.
#[must_use]
pub fn tasks_from_wire(r: &wire::ListTasksResponse) -> Page<AdminTask> {
    Page {
        items: r
            .tasks
            .iter()
            .map(|t| AdminTask {
                id: t.id.clone(),
                owner_id: t.owner_id.clone(),
                title: t.title.clone(),
                status: TaskStatus::from_number(t.status),
                created_at: seconds(&t.created_at),
                due_date: t.due_date.as_option().map(|d| d.seconds),
            })
            .collect(),
        next_page_token: token(&r.next_page_token),
    }
}

/// An audit-log page.
#[must_use]
pub fn audit_from_wire(r: &wire::ListAuditLogResponse) -> Page<AuditEntry> {
    Page {
        items: r
            .entries
            .iter()
            .map(|e| AuditEntry {
                id: e.id.clone(),
                actor_id: e.actor_id.clone(),
                action: e.action.clone(),
                target_kind: e.target_kind.clone(),
                target_id: e.target_id.clone(),
                reason: e.reason.clone(),
                created_at: seconds(&e.created_at),
            })
            .collect(),
        next_page_token: token(&r.next_page_token),
    }
}

/// The tasks request; an absent owner stays empty (every user).
#[must_use]
pub fn tasks_request(owner_id: Option<&str>, page: &PageRequest) -> wire::ListTasksRequest {
    wire::ListTasksRequest {
        owner_id: owner_id.unwrap_or_default().to_owned(),
        page_size: page_size(),
        page_token: page.page_token.clone().unwrap_or_default(),
        ..Default::default()
    }
}

/// The audit-log request.
#[must_use]
pub fn audit_request(page: &PageRequest) -> wire::ListAuditLogRequest {
    wire::ListAuditLogRequest {
        page_size: page_size(),
        page_token: page.page_token.clone().unwrap_or_default(),
        ..Default::default()
    }
}

/// The delete request.
#[must_use]
pub fn delete_request(id: &str, reason: &str) -> wire::DeleteTaskRequest {
    wire::DeleteTaskRequest {
        id: id.to_owned(),
        reason: reason.to_owned(),
        ..Default::default()
    }
}

/// The broadcast request; no target user means everyone (empty `user_id`).
#[must_use]
pub fn broadcast_request(draft: &BroadcastDraft) -> wire::BroadcastNotificationRequest {
    wire::BroadcastNotificationRequest {
        user_id: draft.user_id.clone().unwrap_or_default(),
        title: draft.title.clone(),
        body: draft.body.clone(),
        link: draft.link.clone(),
        ..Default::default()
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    fn ts(seconds: i64) -> MessageField<Timestamp, buffa::Inline<Timestamp>> {
        MessageField::some(Timestamp {
            seconds,
            nanos: 0,
            ..Default::default()
        })
    }

    #[test]
    fn task_status_numbers_map_and_unknown_never_becomes_real() {
        let response = wire::ListTasksResponse {
            tasks: vec![
                wire::AdminTask {
                    id: "a".into(),
                    status: 3,
                    due_date: ts(99),
                    created_at: ts(7),
                    ..Default::default()
                },
                wire::AdminTask {
                    status: 42,
                    ..Default::default()
                },
            ],
            next_page_token: "next".into(),
            ..Default::default()
        };
        let page = tasks_from_wire(&response);
        assert_eq!(page.items[0].status, TaskStatus::Done);
        assert_eq!(
            (page.items[0].due_date, page.items[0].created_at),
            (Some(99), 7)
        );
        assert_eq!(page.items[1].status, TaskStatus::Unknown);
        assert_eq!(page.items[1].due_date, None);
        assert_eq!(page.next_page_token.as_deref(), Some("next"));
    }

    #[test]
    fn requests_carry_owner_reason_and_the_optional_target() {
        assert_eq!(tasks_request(None, &PageRequest::default()).owner_id, "");
        assert_eq!(
            tasks_request(Some("x"), &PageRequest::default()).owner_id,
            "x"
        );
        let delete = delete_request("t", "spam");
        assert_eq!((delete.id.as_str(), delete.reason.as_str()), ("t", "spam"));
        let draft = BroadcastDraft {
            user_id: None,
            title: "T".into(),
            body: "B".into(),
            link: "/x".into(),
        };
        let request = broadcast_request(&draft);
        assert_eq!(request.user_id, "");
        assert_eq!(request.link, "/x");
    }

    #[test]
    fn overview_maps_the_job_lag_field_and_clamps_negatives() {
        let overview = overview_from_wire(&wire::GetOverviewResponse {
            outbox_lag_seconds: 12,
            tasks_done: -1,
            ..Default::default()
        });
        assert_eq!((overview.job_lag_seconds, overview.tasks_done), (12, 0));
    }

    #[test]
    fn audit_entries_map_every_field() {
        let response = wire::ListAuditLogResponse {
            entries: vec![wire::AuditEntry {
                id: "i".into(),
                actor_id: "a".into(),
                action: "task.delete".into(),
                target_kind: "task".into(),
                target_id: "t".into(),
                reason: "why".into(),
                created_at: ts(5),
                ..Default::default()
            }],
            ..Default::default()
        };
        let entry = &audit_from_wire(&response).items[0];
        assert_eq!(
            (entry.action.as_str(), entry.created_at),
            ("task.delete", 5)
        );
        assert_eq!(entry.reason, "why");
    }
}
