# Spec: tasks/complete-task

Type: Command
Module: tasks
Status: Implemented

## Context

Completing a task is the only state change on this server today that
another system/module may care about (for example, future analytics of
user activity), so it is the first place where the transactional outbox pattern on River
(`internal/platform/events`, ADR-0014) is applied instead of publishing
directly to an external broker (there is no broker: `events.Publisher` inserts a River job per consumer in the same transaction; `river_job` is the outbox).

## Scenarios

**Happy path**

- Given the task exists and belongs to the calling user
- When the user calls `CompleteTask`
- Then the task status changes to `done`, `completed_at` is set, and in
  the same transaction River jobs `platform.event_delivery` (one per consumer) are inserted with the event
  `tasks.v1.TaskCompleted`

**Edge cases**

- Given the task does not exist or belongs to another user
- When `CompleteTask` is called
- Then `NotFound` is returned (not `PermissionDenied`; see the doc comment of
  `GetTask` in `application/service.go` about object-level access)

- Given the task is already completed
- When `CompleteTask` is called again
- Then the operation is idempotent: the current task is returned unchanged
  (`completed_at`, `updated_at` and `version` do not change) and **no new event
  row is published**. The transition `todo|in_progress → done` is guarded in SQL
  (`UPDATE … WHERE status <> 'done'`), so a retry, a double click and two
  devices at once yield exactly one `TaskCompleted` event. Deduplication
  on the consumer side (an idempotent handler) is not a substitute: a second event would have
  a different `event_id` and would pass as new. Verified by the integration
  test `TestRepository_Complete_IsIdempotent` (8 goroutines, one delivery).

## Errors

| Condition | `sharederrors.Kind` | `connect.Code` |
| --------- | ------------------- | -------------- |
| Task not found / not the caller's | `KindNotFound` | `CodeNotFound` |
| Database unavailable | `KindUnknown` (Wrap) | `CodeInternal` |

## API

```proto
rpc CompleteTask(CompleteTaskRequest) returns (CompleteTaskResponse);
```

| Field | Type | Required | Description |
| ----- | ---- | -------- | ----------- |
| id | string | yes | Task UUID |

## Events

| Event type | Version | partition_key | Payload | Consumers |
| ---------- | ------- | ------------- | ------- | --------- |
| `tasks.v1.TaskCompleted` | 1 | task id | `{task_id, user_id, completed_at}` (JSON) | notifications (inbox and push) |

## Cross-module dependencies

None. `tasks` does not call `auth` synchronously for this operation; task
ownership is checked against the `user_id` already validated by
`AuthInterceptor` on entry.

## NFR

- Idempotency: no `Idempotency-Key` is required; a repeated call for an already
  completed task is safe by construction (see the edge case above).
- Timeout: the standard `RequestTimeout` (30s, `httpserver.Options`).
- Hot path: no.
