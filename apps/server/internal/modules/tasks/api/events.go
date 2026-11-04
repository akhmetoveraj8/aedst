package api

import "time"

// Integration events this module publishes via platform/events (a River job per consumer, inserted in the producing transaction). These types
// are the published contract: other modules subscribe to the event type on
// the registry and decode the JSON payload into these structs, importing only this
// package (see docs/content/server/events.md and ADR-0006). JSON rather than a
// protobuf contract while every consumer is in-process; when an event has to
// cross a service boundary, promote it to api/proto/aedst/tasks/v1/events.proto
// with the same field names and bump the version.
//
// Evolution rules: fields are only ever added (consumers ignore unknown
// fields), never renamed, retyped or removed within a version; a breaking
// change publishes a new version (…v2) alongside the old one until every
// consumer has moved.
//
// Ordering: River delivers at-least-once and NOT in order (jobs run
// concurrently and are retried independently). Every snapshot event therefore carries the task's
// Version; a projection applies an event only if its version is newer than
// what it already stored (see the search module).
const (
	// TaskCompletedEventType is published when a task moves to done.
	TaskCompletedEventType    = "tasks.v1.TaskCompleted"
	TaskCompletedEventVersion = 1

	// TaskCreatedEventType is published with the new task's snapshot.
	TaskCreatedEventType    = "tasks.v1.TaskCreated"
	TaskCreatedEventVersion = 1

	// TaskUpdatedEventType is published after every UpdateTask that changed
	// the task, with the full post-update snapshot.
	TaskUpdatedEventType    = "tasks.v1.TaskUpdated"
	TaskUpdatedEventVersion = 1

	// TaskDeletedEventType is published when a task is deleted (by its owner
	// or by an operator).
	TaskDeletedEventType    = "tasks.v1.TaskDeleted"
	TaskDeletedEventVersion = 1

	// TaskDueSoonEventType is published once per (task, due date) when the
	// due date is AEDST_TASKS_DUE_SOON_LEAD_MINUTES away and the task is open.
	TaskDueSoonEventType    = "tasks.v1.TaskDueSoon"
	TaskDueSoonEventVersion = 1
)

// TaskCompletedEvent is the payload of TaskCompletedEventType. It is
// deliberately self-contained (it carries the title) so a consumer can build
// its own projection without calling back into tasks.
type TaskCompletedEvent struct {
	TaskID      string    `json:"task_id"`
	UserID      string    `json:"user_id"`
	Title       string    `json:"title"`
	CompletedAt time.Time `json:"completed_at"`
	// Version is the task version after completion (added in v1, 0 from
	// producers that predate it).
	Version int `json:"version,omitempty"`
}

// TaskSnapshot is the payload of TaskCreatedEventType and TaskUpdatedEventType.
type TaskSnapshot struct {
	TaskID      string     `json:"task_id"`
	UserID      string     `json:"user_id"`
	Title       string     `json:"title"`
	Description string     `json:"description"`
	Status      string     `json:"status"`
	Priority    string     `json:"priority"`
	DueDate     *time.Time `json:"due_date,omitempty"`
	CreatedAt   time.Time  `json:"created_at"`
	UpdatedAt   time.Time  `json:"updated_at"`
	Version     int        `json:"version"`
}

// TaskDeletedEvent is the payload of TaskDeletedEventType. Version is one
// above the last stored version, so it outranks every earlier snapshot.
type TaskDeletedEvent struct {
	TaskID    string    `json:"task_id"`
	UserID    string    `json:"user_id"`
	DeletedAt time.Time `json:"deleted_at"`
	Version   int       `json:"version"`
}

// TaskDueSoonEvent is the payload of TaskDueSoonEventType.
type TaskDueSoonEvent struct {
	TaskID  string    `json:"task_id"`
	UserID  string    `json:"user_id"`
	Title   string    `json:"title"`
	DueDate time.Time `json:"due_date"`
	// OccurredAt is when the reminder fired.
	OccurredAt time.Time `json:"occurred_at"`
}

// SnapshotOf builds the snapshot payload of t.
func SnapshotOf(t Task) TaskSnapshot {
	return TaskSnapshot{
		TaskID:      t.ID.String(),
		UserID:      t.UserID.String(),
		Title:       t.Title,
		Description: t.Description,
		Status:      string(t.Status),
		Priority:    string(t.Priority),
		DueDate:     t.DueDate,
		CreatedAt:   t.CreatedAt,
		UpdatedAt:   t.UpdatedAt,
		Version:     t.Version,
	}
}
