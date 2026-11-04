---
title: Feature spec - Tasks
description: Behaviour spec of the reference Tasks feature - RPCs, list query, validation limits, unknown-enum policy, offline writes, analytics events and i18n keys - so a new client or a product feature of your own can start from text.
---

# Feature spec: Tasks (reference module)

Tasks is the reference vertical slice. It is implemented on the server and on all four clients, and the
[client recipe](/client-recipe) names the file each step produces. This page is the language-neutral spec: copy the
shape for your own feature, change the nouns.

Source of truth for the wire contract: `apps/server/api/proto/aedst/tasks/v1/tasks.proto`. Feature declaration:
the `tasks` row in `features.yaml` (not flagged; outbox types `task.create`, `task.update`; i18n namespace `tasks`;
route `/tasks`).

## RPCs a client uses

| RPC | Used for | Notes |
|---|---|---|
| `ListTasks` | list, search, filters, paging | see "List query" |
| `GetTask` | detail | `id` is a UUID |
| `CreateTask` | create | needs an `Idempotency-Key` header when sent from the outbox |
| `UpdateTask` | edit title, description, priority, due date | never changes status; `update_mask` names the fields; `expected_version` detects concurrent edits (`conflict`) |
| `CompleteTask` / `ReopenTask` | the only way status moves to or from `DONE` | |
| `DeleteTask` | delete | admin deletes are a separate feature (`admin`) |
| `GetTaskStats` | dashboard counters (total, todo, in progress, done, overdue) | one aggregate call, never computed from a list |

## List query (identical on every client)

```
list(TaskQuery { search, statuses[], priorities[], sort, pageToken })
  pageSize   = 20            (server default is 20, clamp 100)
  sort       = created_at DESC   (the default; due-date asc/desc are the other options)
  search     = trimmed, at most 200 characters, case-insensitive substring of title + description
  pageToken  = opaque; echo back exactly what the last response returned, with the same filters and sort
```

- `totalCount` arrives on the **first page only**; keep it from the first response.
- The server returns only a *next* token. "Previous" is a client-side stack of visited tokens. On web that stack
  lives in the URL (`?q=&status=&priority=&sort=&cursors=`, shared `cursor-params` parsers) so reload, back and
  share restore the view.
- Web URL values: status `all|todo|in-progress|done`, priority `all|low|medium|high|urgent`, sort
  `created-desc|created-asc|due-asc|due-desc`. Defaults are omitted from the URL.

## Validation (client-side, mirrors the proto)

| Field | Rule |
|---|---|
| title | required after trimming, 1 to 200 code points |
| description | at most 4000 code points |
| priority | required on create; one of low, medium, high, urgent (never unknown) |
| due date | optional; a calendar day entered as `yyyy-MM-dd` is parsed as **local** midnight (never `new Date(text)`, which is UTC) |

On web the rules come from the proto through `protovalidateResolver`; the error is branched by rule type
(`string.min_len` shows `titleRequired`, `string.max_len` shows `titleTooLong`). Android, Apple and Desktop enforce
the same limits in `CreateTaskUseCase`.

## Unknown enum policy

`TaskStatus` and `TaskPriority` can carry values this build does not know (`UNSPECIFIED`, or a newer server).

- The data layer maps them to `unknown` (`UNKNOWN` / `.unknown`), never to `todo` or `medium`.
- The UI renders a neutral "unknown" badge and does not offer `unknown` in pickers.
- When writing, `unknown` becomes `UNSPECIFIED` so server validation rejects it explicitly.
- `switch` over these enums is exhaustive, with no `default:`.

## Errors

Every failure is one of the thirteen shared kinds (`docs/contract/behavior/error-kinds.json`). The UI renders the
translated message for the **kind** (`common.errors.kinds.<kind>` on web), never the raw server message; the raw
message goes only to the crash reporter, and only for `unknown` and `storage`. `cancelled` shows nothing.
Retryable kinds: `rateLimited`, `unavailable`, `offline`, `timeout`.

## Offline writes

Create and update go through the outbox: the item id is the idempotency key, delivery is `deliver`, and the types are
`task.create` and `task.update` (checked against `knownTypes` in `offline-outbox.json`). Rules (retry, permanent
failure, blocked on `upgradeRequired`) are in `docs/contract/behavior/offline-outbox.json`. The list shows pending and
failed badges (`sync.*` keys). Android has no handler yet (declared GAP in `features.yaml`).
After a drain, web invalidates the whole cache once per run, not per item; a single mutation invalidates only
`TasksService` queries (`createConnectQueryKey({ schema: TasksService, cardinality: undefined })`).

## Analytics events

Names are fixed by `docs/contract/analytics-events.json`:

| Event | Properties | When |
|---|---|---|
| `task_created` | `priority`, `has_due_date` | after a create succeeds (or is queued and delivered) |
| `task_completed` | none | after complete succeeds |

No titles, descriptions or other free text, ever. Web sends events only after consent (and never with Sec-GPC).

## i18n keys (namespace `tasks`, five locales)

Web files are `i18n/{en,ru,tj,uz,ar}.json`; the other platforms map the same keys to their format (see
[i18n](/i18n)). Groups and keys on web:

- `dashboard`: title, totalTasks, todo, inProgress, completed, overdue
- `list`: searchPlaceholder, newTask, allStatuses, allPriorities, sortCreatedDesc, sortCreatedAsc, sortDueAsc,
  sortDueDesc, emptyTitle, emptyDescription, noResultsTitle, noResultsDescription, errorTitle, retry, previousPage,
  nextPage, due, searchLabel, statusFilterLabel, priorityFilterLabel, sortLabel, paginationLabel, resultsLabel
- `status`: todo, inProgress, done (plus an unknown label on native clients)
- `priority`: low, medium, high, urgent
- `form`: createTitle, editTitle, titleLabel, titleRequired, titleTooLong, descriptionLabel, descriptionTooLong,
  priorityLabel, priorityRequired, dueDateLabel, dueDateOptional, cancel, create, save, error
- `details`: backToList, createdBy, you, createdAt, updatedAt, dueDate, noDueDate, edit, complete, reopen, delete,
  deleteConfirmTitle, deleteConfirmDescription, deleteConfirmAction, deleteCancelAction, notFoundTitle,
  notFoundDescription, loadErrorTitle
- `a11y`: priority, status
- `sync`: pendingBadge, failedBadge, discard, queuedTitle, queuedHint

## Starting your own feature from this spec

1. Replace the nouns, keep the shape: list query with `pageSize 20` and a default sort, a use case only where the
   client has logic, one data file with proto types, an `unknown` for every enum.
2. Fill the `features.yaml` row (flagged, outbox types, i18n namespace, routes) before writing code.
3. Follow the eight steps in the [client recipe](/client-recipe); add a scenario under `docs/contract/behavior/` if the
   feature has rules that must not drift between clients.
