# `apps/web/shared` — cross-platform module mapping

This directory is web's equivalent of `core/` (Android), `Core/` (Apple), and
`Modules/Core/` (Desktop): non-feature-specific, reusable infrastructure that
feature modules (`src/modules/*`) depend on but never bypass to reach each
other. The `check:feature-boundaries` script enforces that feature modules
only talk to each other through this layer — mirroring
`apps/android/scripts/check-feature-boundaries.sh`,
`apps/apple/scripts/check-feature-boundaries.sh`, and
`apps/desktop/scripts/check-feature-boundaries.sh`.

Unlike the native platforms, this directory is **not** split into separate
build packages/modules (there is no Gradle/SPM/CMake module boundary in a
Next.js app) — it's one TypeScript package with concern-based sibling
directories, which is the closest Next.js-idiomatic equivalent of the native
per-concern module split. The table below maps each subfolder to its native
counterpart so contributors moving between platforms recognize the
equivalence, even where the web directory keeps its already-idiomatic web
name instead of being physically renamed.

| `apps/web/shared/*`                               | Native equivalent                                                                                            | Status                            | Notes                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ------------------------------------------------- | ------------------------------------------------------------------------------------------------------------ | --------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `ui/`                                             | `core/ui` (Android), `AedstDesignSystem` (Apple), `DesignSystem` (Desktop)                                   | **Documented only — not renamed** | Already _is_ the web design system: shadcn/ui-generated primitives (`button.tsx`, `dialog.tsx`, ...). Kept as `ui/` because that's the established web/shadcn convention and `CONVENTIONS.md` already documents a naming exception for this directory (kebab-case files, `shadcn` CLI-owned). Renaming would fight the shadcn CLI's own regeneration path for no structural benefit.                                                                                                                                        |
| `api/connect/`                                    | `core/network` (Android), `AedstNetwork` (Apple), `Network` (Desktop)                                        | **Documented only — not renamed** | The ConnectRPC transport/client setup and generated protobuf stubs — this is web's network layer. Left as `api/` rather than renamed to `network/` because (a) "api" is the idiomatic name for this in the web/TypeScript ecosystem, (b) it's referenced extensively in prose across this README, `.env.example`, and `docs/content/decisions/0002-connectrpc.md`, so a rename's documentation churn outweighs the benefit of matching native vocabulary exactly.                                                           |
| `date/`                                           | Not a dedicated native module — closest to a `core/common` (Android) / `AedstCore` (Apple) helper            | **Moved** (was `lib/date/`)       | Locale-aware `date-fns` formatting helpers. Flattened to a sibling of `ui/`/`api/` (mechanical, 2 importers) because it's a self-contained leaf concern, same as how native `core/common` isolates single-purpose helpers.                                                                                                                                                                                                                                                                                                  |
| `env/`                                            | Platform config/environment access (Android `BuildConfig`, Apple `Bundle`/xcconfig, Desktop `QSettings`/env) | **Moved** (was `lib/env/`)        | `client.ts` (`NEXT_PUBLIC_*`, safe in the browser bundle) / `server.ts` (`server-only`-guarded secrets). Flattened to a sibling directory (mechanical, ~5 importers) — this is purely a Next.js-specific split (client vs. server bundle boundary) that has no exact native analog, so it gets its own concern-named directory rather than living under a generic `lib/`.                                                                                                                                                   |
| `lib/auth/`                                       | `core/network`'s `AuthInterceptor` + `core/security` (Android)                                               | **Documented only — not split**   | Server-side session: `session-cookies.ts`, `session-claims.ts`, `session-tokens.ts`, `refresh-session.ts`, `session.ts` (httpOnly cookies, single-flight refresh), `safe-redirect.ts`, and `auth-provider.tsx` (client mirror of _who_ is signed in). No token ever reaches page JavaScript. Route protection lives in `src/proxy.ts`, not in a shared component, so `shared` no longer imports from `app`.                                                                                                                 |
| `lib/errors/`                                     | `core/common`'s `AedstError` (Android), error mapping in `AedstNetwork` (Apple)                              | **New**                           | One error vocabulary: `toAppError` maps ConnectError codes/aborts/offline to an `AppErrorKind` (translated under `common.errors.kinds`), `isRetryable` drives the QueryClient retry policy (never retry the 4xx family), `reportError` is the single path to Sentry (same tags everywhere), `ErrorBoundary` wraps Sentry's boundary for widgets.                                                                                                                                                                            |
| `lib/analytics/`                                  | Platform analytics wrappers                                                                                  | **New**                           | PostHog behind consent/DNT/key gates (`enableAnalytics`, typed `track()`, `identifyUser`) and `useFeatureFlag` with typed defaults. The SDK is a dynamic import loaded only after consent.                                                                                                                                                                                                                                                                                                                                  |
| `lib/stores/`                                     | ViewModel-held UI state                                                                                      | **New**                           | zustand stores for genuine client UI state (see "State" below).                                                                                                                                                                                                                                                                                                                                                                                                                                                             |
| `lib/pwa/`, `lib/auth/sign-out-hooks.ts`          | Platform services                                                                                            | **New**                           | Push payload parsing shared with the service worker, install-prompt hook; sign-out hooks let modules clean up (push unregistration, SW caches) before the session ends without the auth module importing them.                                                                                                                                                                                                                                                                                                              |
| `lib/hooks/`, `lib/utils/`, `lib/query-client.ts` | `core/common` (Android), `AedstCore` (Apple), `Common` (Desktop)                                             | **Documented only — not renamed** | Small, general-purpose cross-cutting utilities (the `cn()` class-name helper, a `useIsMobile` hook, the shared TanStack Query client instance) with no feature-specific logic — this is exactly what native `core/common`/`Common` holds. Left under the existing, idiomatic `lib/` name (standard in the JS/TS ecosystem) rather than renamed to `common/`, since the value of matching native vocabulary exactly did not outweigh the import churn for a directory whose meaning is already unambiguous on this platform. |

## Feature module internal shape

Native `feature/auth` modules use a consistent internal layout: `Data/`,
`Domain/`, `Navigation/`, `Presentation/` (Apple/Desktop), plus `i18n/` and
`tests/` (Desktop). Web's `src/modules/*` currently use `ui/` (≈
`Presentation/`), `lib/` (≈ a thin `Domain`+`Data` combined — Next.js modules
don't need a separate repository/data-source abstraction layer since
ConnectRPC + TanStack Query hooks are called directly from `ui/`), and `i18n/`
(already matches the native `i18n/` directory 1:1). Web does not have a
`Navigation/` folder per module because Next.js's file-system router
(`src/app/**`) _is_ the navigation layer, composed at the `app/` level rather
than declared inside each feature module — there's no separate
navigation-graph module to mirror.

This mapping is intentionally left as documentation rather than an enforced
physical restructure: introducing empty `domain/`/`data/`/`navigation/`
subfolders into `src/modules/{auth,tasks}` today would add ceremony
without moving any code (there is no separate data-source/repository
abstraction yet, and no per-module navigation graph to extract), which
contradicts the Library-First "don't add abstraction before there's a
documented technical reason" rule in
[`docs/content/library-first.md`](../../../docs/content/library-first.md).
Revisit if a module's `lib/` grows enough that separating its data-fetching
code from its pure domain logic becomes genuinely useful.

## State: who owns what

| Kind of state                                                                      | Owner                                                                                          | Examples                                                                              |
| ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------- |
| **Server state** — anything apps/server is the source of truth for                 | **TanStack Query** (via connect-query hooks; prefetched in Server Components where it matters) | tasks, notifications, unread count, media, search results, admin lists                |
| **URL state** — anything a reload, a shared link or the back button should restore | **nuqs**                                                                                       | task filters/sort/cursors, `/search?q=&kind=`, `/notifications?unread=true`           |
| **Form state**                                                                     | **React Hook Form** (+ Zod)                                                                    | task form, admin broadcast, delete reason                                             |
| **Client UI state** shared across distant components, or persisted per device      | **zustand** (`lib/stores/`, or `modules/<m>/lib/*-store.ts` when one module owns it)           | command-palette open, upload queue (progress, cancel/retry), install-prompt dismissal |
| **Local component state**                                                          | `useState`                                                                                     | a dialog's open flag, an input's draft                                                |

**Rule (Must):** never put server data in a zustand store. Copying a query result into a store creates a second, stale cache that invalidation, refetch-on-focus and optimistic updates cannot see. A store may hold _ids_ or UI flags that refer to server data (the upload queue holds a `mediaId` once the server returns one); the data itself is read through TanStack Query. Persist a store (`persist` middleware) only for non-sensitive per-device preferences — never tokens or personal data.
