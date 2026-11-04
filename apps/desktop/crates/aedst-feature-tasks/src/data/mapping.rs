//! Wire <-> domain. The only file that knows both the generated types and the domain model.

use aedst_contract::proto::aedst::tasks::v1 as wire;
use buffa::{EnumValue, MessageField};
use buffa_types::google::protobuf::Timestamp;

use crate::domain::{NewTask, PAGE_SIZE, Task, TaskPage, TaskPriority, TaskQuery, TaskStatus};

/// Unknown or unspecified server values map to `Unknown`, never to a real status.
#[must_use]
pub fn status_from_wire(value: &EnumValue<wire::TaskStatus>) -> TaskStatus {
    match value {
        EnumValue::Known(wire::TaskStatus::TASK_STATUS_TODO) => TaskStatus::Todo,
        EnumValue::Known(wire::TaskStatus::TASK_STATUS_IN_PROGRESS) => TaskStatus::InProgress,
        EnumValue::Known(wire::TaskStatus::TASK_STATUS_DONE) => TaskStatus::Done,
        EnumValue::Known(wire::TaskStatus::TASK_STATUS_UNSPECIFIED) | EnumValue::Unknown(_) => {
            TaskStatus::Unknown
        }
    }
}

/// See [`status_from_wire`].
#[must_use]
pub fn priority_from_wire(value: &EnumValue<wire::TaskPriority>) -> TaskPriority {
    match value {
        EnumValue::Known(wire::TaskPriority::TASK_PRIORITY_LOW) => TaskPriority::Low,
        EnumValue::Known(wire::TaskPriority::TASK_PRIORITY_MEDIUM) => TaskPriority::Medium,
        EnumValue::Known(wire::TaskPriority::TASK_PRIORITY_HIGH) => TaskPriority::High,
        EnumValue::Known(wire::TaskPriority::TASK_PRIORITY_URGENT) => TaskPriority::Urgent,
        EnumValue::Known(wire::TaskPriority::TASK_PRIORITY_UNSPECIFIED) | EnumValue::Unknown(_) => {
            TaskPriority::Unknown
        }
    }
}

/// When writing, `Unknown` becomes `UNSPECIFIED` so the server rejects it explicitly.
#[must_use]
pub fn priority_to_wire(priority: TaskPriority) -> EnumValue<wire::TaskPriority> {
    EnumValue::Known(match priority {
        TaskPriority::Low => wire::TaskPriority::TASK_PRIORITY_LOW,
        TaskPriority::Medium => wire::TaskPriority::TASK_PRIORITY_MEDIUM,
        TaskPriority::High => wire::TaskPriority::TASK_PRIORITY_HIGH,
        TaskPriority::Urgent => wire::TaskPriority::TASK_PRIORITY_URGENT,
        TaskPriority::Unknown => wire::TaskPriority::TASK_PRIORITY_UNSPECIFIED,
    })
}

/// A wire task as the domain sees it.
#[must_use]
pub fn task_from_wire(task: &wire::Task) -> Task {
    Task {
        id: task.id.clone(),
        title: task.title.clone(),
        description: task.description.clone(),
        status: status_from_wire(&task.status),
        priority: priority_from_wire(&task.priority),
        due_date: task.due_date.as_option().map(|t| t.seconds),
        created_at: task.created_at.as_option().map_or(0, |t| t.seconds),
        version: task.version,
    }
}

fn timestamp(seconds: i64) -> MessageField<Timestamp, buffa::Inline<Timestamp>> {
    MessageField::some(Timestamp {
        seconds,
        nanos: 0,
        ..Default::default()
    })
}

/// The create request. An absent due date stays unset.
#[must_use]
pub fn create_request(new: &NewTask) -> wire::CreateTaskRequest {
    let mut request = wire::CreateTaskRequest {
        title: new.title.clone(),
        description: new.description.clone(),
        priority: priority_to_wire(new.priority),
        ..Default::default()
    };
    if let Some(due) = new.due_date {
        request.due_date = timestamp(due);
    }
    request
}

/// The list request: `created_at DESC`, page size 20, the search trimmed to 200 characters.
#[must_use]
pub fn list_request(query: &TaskQuery) -> wire::ListTasksRequest {
    wire::ListTasksRequest {
        search: query.search.trim().chars().take(200).collect(),
        sort_by: EnumValue::Known(wire::TaskSortField::TASK_SORT_FIELD_CREATED_AT),
        sort_direction: EnumValue::Known(wire::SortDirection::SORT_DIRECTION_DESC),
        page_size: i32::try_from(PAGE_SIZE).unwrap_or(20),
        page_token: query.page_token.clone().unwrap_or_default(),
        ..Default::default()
    }
}

/// A list response. `total_count` is meaningful on the first page only.
#[must_use]
pub fn page_from_wire(response: &wire::ListTasksResponse, first_page: bool) -> TaskPage {
    TaskPage {
        tasks: response.tasks.iter().map(task_from_wire).collect(),
        next_page_token: Some(response.next_page_token.clone()).filter(|t| !t.is_empty()),
        total_count: first_page.then(|| u32::try_from(response.total_count).unwrap_or(0)),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn unspecified_and_unknown_enums_are_unknown_never_a_real_value() {
        assert_eq!(
            status_from_wire(&EnumValue::Known(wire::TaskStatus::TASK_STATUS_UNSPECIFIED)),
            TaskStatus::Unknown
        );
        assert_eq!(
            status_from_wire(&EnumValue::Unknown(42)),
            TaskStatus::Unknown
        );
        assert_eq!(
            priority_from_wire(&EnumValue::Unknown(42)),
            TaskPriority::Unknown
        );
        assert_eq!(
            status_from_wire(&EnumValue::Known(wire::TaskStatus::TASK_STATUS_DONE)),
            TaskStatus::Done
        );
    }

    #[test]
    fn writing_unknown_sends_unspecified() {
        assert_eq!(
            priority_to_wire(TaskPriority::Unknown),
            EnumValue::Known(wire::TaskPriority::TASK_PRIORITY_UNSPECIFIED)
        );
    }

    #[test]
    fn a_task_maps_with_and_without_a_due_date() {
        let mut task = wire::Task {
            id: "a".into(),
            title: "t".into(),
            status: EnumValue::Known(wire::TaskStatus::TASK_STATUS_TODO),
            priority: EnumValue::Known(wire::TaskPriority::TASK_PRIORITY_HIGH),
            version: 3,
            ..Default::default()
        };
        assert_eq!(task_from_wire(&task).due_date, None);
        task.due_date = timestamp(86_400);
        let mapped = task_from_wire(&task);
        assert_eq!(
            (mapped.due_date, mapped.priority, mapped.version),
            (Some(86_400), TaskPriority::High, 3)
        );
    }

    #[test]
    fn the_list_request_uses_the_spec_defaults_and_clamps_the_search() {
        let request = list_request(&TaskQuery {
            search: format!("  {}  ", "x".repeat(300)),
            page_token: Some("tok".into()),
        });
        assert_eq!(request.page_size, 20);
        assert_eq!(request.search.chars().count(), 200);
        assert_eq!(request.page_token, "tok");
        assert_eq!(
            request.sort_by,
            EnumValue::Known(wire::TaskSortField::TASK_SORT_FIELD_CREATED_AT)
        );
        assert_eq!(
            request.sort_direction,
            EnumValue::Known(wire::SortDirection::SORT_DIRECTION_DESC)
        );
    }

    #[test]
    fn total_count_only_comes_from_the_first_page_and_an_empty_token_means_last() {
        let response = wire::ListTasksResponse {
            total_count: 41,
            next_page_token: String::new(),
            ..Default::default()
        };
        assert_eq!(page_from_wire(&response, true).total_count, Some(41));
        assert_eq!(page_from_wire(&response, false).total_count, None);
        assert_eq!(page_from_wire(&response, true).next_page_token, None);
    }
}
