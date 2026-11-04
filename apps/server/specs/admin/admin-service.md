# Spec: admin/admin-service

Type: Command + Query
Module: admin
Status: Implemented

## Context

A composition layer for operators. Its only own table is the audit log
`admin.audit_log`; everything else is read and changed through the `api/` packages
of other modules (tasks, notifications, auth, media). The `admin` role is required
for every RPC: the built-in default policy
`/aedst.admin.v1.AdminService/*=admin` (overridable with the same key in
`AEDST_ROLE_POLICY`) is enforced by `httpserver.RoleInterceptor`.

## Scenarios

**Happy path**

- `DeleteTask{id, reason}` → in ONE transaction: `tasks/api.AdminService.DeleteTaskTx`
  (deletion + delivery of `tasks.v1.TaskDeleted` to consumers as River jobs in the same transaction) and an audit record.
- `BroadcastNotification{user_id?, title, body, link}` → in one transaction
  `notifications/api.Broadcaster.BroadcastTx` (notifications + push jobs) and an audit record.
- `GetOverview` → module counters + the age of the oldest ready River job (`outbox_lag_seconds` on the wire, name kept) + pending River jobs.

**Edge cases**

- A mutation error → rollback, no audit record.
- A broadcast link must be relative (`/...`), otherwise `INVALID_ARGUMENT` (open redirect).
- A call without the `admin` role → `PERMISSION_DENIED` before the handler.

## Errors

| Condition | `sharederrors.Kind` | `connect.Code` |
| --------- | ------------------- | -------------- |
| No admin role | — (RoleInterceptor) | PERMISSION_DENIED |
| reason shorter than 3 characters, bad token/link | Validation | INVALID_ARGUMENT |
| Task not found | NotFound | NOT_FOUND |

## API

`aedst.admin.v1.AdminService`.

## Events

None of its own; mutations publish the events of the owning modules (`tasks.v1.TaskDeleted`).

## Cross-module dependencies

A deliberate exception to the rule "transactions do not cross modules": admin
passes its own `pgx.Tx` to the `*Tx` methods of `tasks/api` and `notifications/api`, so that
the audit record and the action are committed atomically (one database, different schemas).

## NFR

- Audit retention: `AEDST_RETENTION_AUDIT_DAYS` (365).
- Pagination: keyset by `(created_at, id)` for audit, tasks and users.
