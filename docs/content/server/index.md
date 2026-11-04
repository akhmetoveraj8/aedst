---
description: "apps/server — a Go modular monolith (net/http ServeMux, ConnectRPC, PostgreSQL, Valkey) that is the single backend for the four clients (web, android,..."
title: Server
---

# Server

`apps/server` — a Go modular monolith (net/http ServeMux, ConnectRPC, PostgreSQL, Valkey) that is the single backend for the four clients (web, android, apple, desktop). Status: **Verified** (see [Platform status](/status)).

| Page | What it covers |
|---|---|
| [Architecture](/server/architecture) | Modular monolith, request flow, module boundary rule, extraction path |
| [Stack](/server/stack) | Every tool and pinned version |
| [Modules](/server/modules) | Module set, ownership and dependency graph |
| [Database](/server/database) | Schema-per-module ownership, migrations, connection pools |
| [Events](/server/events) | River `InsertTx` events: publisher, consumer registry, delivery, retries |
| [Scaling guide](/server/scaling) | What to measure, when to extract, load-test baselines |
| [Deployment](/server/deployment) | Local stack, Helm / Kubernetes, edge |
| [Runbook](/server/runbook) | What to do when each alert fires |

Related: [ADRs](/decisions), [Library-First: Server](/library-first#server-go).
