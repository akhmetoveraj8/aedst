# Spec: tasks/reopen-task

Type: Command
Module: tasks
Status: Implemented

## Context

`ReopenTask` is the inverse of `CompleteTask` (see `complete-task.md`). It moves a
done task back to `todo` and clears `completed_at`. Projections that keep the task's
status (search) must see the transition, so it publishes `tasks.v1.TaskUpdated` with
the post-reopen snapshot, in the same transaction, like every other state change.

## Scenarios

**Happy path**

- Given the task exists, belongs to the calling user and is `done`
- When the user calls `ReopenTask`
- Then `status` becomes `todo`, `completed_at` is cleared, `version` is bumped, and in
  the same transaction River jobs `platform.event_delivery` (one per consumer) are
  inserted with the event `tasks.v1.TaskUpdated` (payload: `TaskSnapshot`).

**Edge cases**

- Given the task is not done (already `todo`/`in_progress`)
- When `ReopenTask` is called
- Then the current task is returned unchanged (`version`, `updated_at` do not change) and
  **no event is published**. The transition is guarded in SQL (`UPDATE ... WHERE status = 'done'`),
  so a retry, a double tap and two devices at once yield exactly one `TaskUpdated`.
  Verified by `TestRepository_EachMutationPublishesExactlyOneEvent`.
- Given the task does not exist or belongs to another user
- When `ReopenTask` is called
- Then `NotFound` is returned and nothing is published.

## Errors

| Condition | `sharederrors.Kind` | `connect.Code` |
| --------- | ------------------- | -------------- |
| Task not found / not the caller's | `KindNotFound` | `CodeNotFound` |
| Database unreachable | `KindUnavailable` (Wrap) | `CodeUnavailable` (+ `Retry-After`) |
| Statement timeout | `KindTimeout` (Wrap) | `CodeDeadlineExceeded` |

## Events

| Type | Version | Payload | When |
| ---- | ------- | ------- | ---- |
| `tasks.v1.TaskUpdated` | 1 | `TaskSnapshot` (post-reopen) | once per real `done -> todo` transition |

## Invariants

`tasks.tasks` enforces `status = 'done'` exactly when `completed_at IS NOT NULL`
(`tasks_done_has_completed_at`), so a half-reopened row cannot exist.
