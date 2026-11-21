---
title: "Modules"
description: "One section per module: what it owns, its features, API reference, OpenAPI document, events, storage and clients."
---

# Modules

One section per module. Each has an overview (what the module owns, its features, events, storage, jobs and clients) and its API reference, generated from the `.proto` files together with an OpenAPI 3.1 document. The rules for modules and features are in [modules and features](/architecture/modules-and-features); how to call any API is in the [API overview](/api).

| Module | Owns | API reference | OpenAPI |
|---|---|---|---|
| [Tasks](/modules/tasks) | A user's tasks: create, read, list, edit, delete, complete and reopen, plus due-soon reminders | [tasks](/modules/tasks/api) | [YAML](/openapi/aedst.tasks.v1.yaml) |
| [Media](/modules/media) | Uploaded files | [media](/modules/media/api) | [YAML](/openapi/aedst.media.v1.yaml) |
| [Notifications](/modules/notifications) | The in-app inbox, per-kind preferences and push delivery (Web Push, FCM, APNs) | [notifications](/modules/notifications/api) | [YAML](/openapi/aedst.notifications.v1.yaml) |
| [Search](/modules/search) | A read-only search projection over the caller's own content | [search](/modules/search/api) | [YAML](/openapi/aedst.search.v1.yaml) |
| [Capabilities](/modules/capabilities) | Capability negotiation: the server identity, the supported client releases and the enabled features | [capabilities](/modules/capabilities/api) | [YAML](/openapi/aedst.capabilities.v1.yaml) |
| [Play Integrity](/modules/integrity) | Verification of Google Play Integrity standard tokens and the server-side policy (package, freshness, request binding, verdicts, replay) | [integrity](/modules/integrity/api) | [YAML](/openapi/aedst.integrity.v1.yaml) |
| [App Attest](/modules/appattest) | Apple App Attest: challenges, key enrolment and assertion verification | [appattest](/modules/appattest/api) | [YAML](/openapi/aedst.appattest.v1.yaml) |
| [Admin](/modules/admin) | Operator actions and their audit log | [admin](/modules/admin/api) | [YAML](/openapi/aedst.admin.v1.yaml) |
| [Webhooks](/modules/webhooks) | Outbound webhooks: the endpoint registry, the fan-out of events to endpoints and the delivery log | [webhooks](/modules/webhooks/api) | [YAML](/openapi/aedst.webhooks.v1.yaml) |

Platform contract (no module): [Event ingest](/api/events), [OpenAPI](/openapi/aedst.events.v1.yaml).

A new module adds its section here in the same change (`task new:module`); the API page is written by `task docs:api` and the OpenAPI document by `task server:gen:openapi`.
