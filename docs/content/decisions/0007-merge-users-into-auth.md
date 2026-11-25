---
title: "ADR-0007: Merge the users module into auth; profile removed"
description: "Accepted"
---

# ADR-0007: Merge the users module into auth; profile removed

## Status
Accepted. **Superseded 2026-11-04:** the `auth` module itself was removed ([ADR-0019](../../../apps/server/docs/adr/0019-remove-first-party-auth.md)); the server keeps no identity records, the IdP does.

## Context
The original module set (`auth`, `users`, `profile`) existed to demonstrate
the AEDST module pattern, not because the product needed three separate
bounded contexts around "a person." In practice:

- `users` owned exactly one thing beyond what `auth` already stored
  (`roles`, which nothing ever read — RBAC was explicitly out of scope) and
  existed mainly to host `RegisterUser`, which called into `auth`'s
  `api/` package in-process anyway.
- `profile`'s only integration point with the rest of the system was
  consuming `users`' `UserRegistered` event to create a default row —
  removing `users` removes that event's only consumer.

`tasks` (see `docs/content/server/modules.md`) replaced them as the reference module —
the example a new module is expected to copy needed to demonstrate a real
owned resource with CRUD, pagination, filtering, and an authorization rule,
which a thin identity/profile pair did not.

## Decision
- `auth` now owns registration directly: `AuthService.Register` replaces
  the old `UsersService.RegisterUser`, and `AuthService.GetCurrentUser`
  replaces `UsersService.GetUser` for the one case that mattered (a client
  asking "who am I," derived from its own bearer token — never a lookup of
  an arbitrary user id, which `users` did support and nothing used).
- The `User` message dropped `roles` — it was dead weight (see Context).
  Re-add it if/when real role assignment lands, against the concrete
  requirements that exist at that point rather than a placeholder.
- `internal/modules/users` and `internal/modules/profile` are deleted
  outright, along with their proto packages, Postgres schemas
  (`users.users`, `profile.profiles`), and the `UserRegistered`/
  `ProfileUpdated` events. Nothing else consumed either event.
- `apps/android`'s `feature/users`/`feature/profile`, `apps/apple`'s
  `Features/Users`/`Features/Profile`, and the earlier desktop app's `Modules/Features/Users`/`Modules/Features/Profile` (that app was later replaced by the Rust + Slint `apps/desktop`) were deleted the same
  way, keeping only `feature/auth`/`Features/Auth` on the other platforms. None of them gained a `tasks` feature in this change —
  `tasks` is a reference module for server + web only (see
  `docs/content/server/architecture.md`); a mobile/desktop `tasks` feature, if ever built,
  follows the same four-layer shape `feature/auth` already demonstrates on
  each platform.

## Consequences
- This is a breaking proto change (`buf breaking` fails against `main` by
  design — `UsersService`/`ProfileService` are gone, `AuthService` gained
  RPCs). Acceptable here because nothing outside this repo depends on the
  old contract yet; a real breaking change against a deployed API would
  need a versioning/migration story this ADR doesn't have to solve.
- Android/Apple/Desktop currently have no screen to land on after login —
  each platform's `initialRoute()`/equivalent now points at the login
  route unconditionally (previously it routed to the deleted `users/home`).
  A follow-up module (the first one built after `tasks` proves the pattern
  works, or a mobile `tasks` feature itself) is expected to give a
  post-login destination back.
- The `AEDST_USERS` NATS stream and its one event
  (`aedst.users.user_registered.v1`) are gone. NATS/JetStream itself stays
  — see `docs/decisions/0004-nats-jetstream.md` — the next module that
  needs async, decoupled cross-module notification reaches for it again.
