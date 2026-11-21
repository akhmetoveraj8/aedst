# Naming: Web (TypeScript / React / Next.js, `apps/web`: `shared`, `app`, `admin`, `landing`)

Part of [CONVENTIONS.md](../../../CONVENTIONS.md). The same rules apply in all four web directories. Levels: **Must** = enforced (linter/CI), **Should** = needs a one-line PR justification to deviate, **Could** = preference.

| What | Rule | Example | Why | Level |
|---|---|---|---|---|
| Every source file (utilities, hooks, config, scripts, styles) | `kebab-case.ts` | `token-storage.ts`, `use-auth.ts` | Matches Next.js kebab-case routes and npm package names; uniform on every filesystem | Must |
| React component files (not framework files) | `kebab-case.tsx`; the exported component stays `PascalCase` and the file name is its kebab-case form | `task-list.tsx` exports `TaskList`, `dashboard-stats.tsx` exports `DashboardStats` | One file-name rule for the whole web tree (owner decision, 2026-11-21): no case-only renames on case-insensitive filesystems, same style as `shared/ui` and the shadcn CLI output | Must |
| Framework-mandated files (Next.js App Router) | Exactly `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`; the name cannot change | `app/(pages)/[locale]/tasks/page.tsx` | Next.js resolves routing by these literal names; this is a framework contract, not a naming violation | Must |
| Framework-mandated files (TanStack Router, `admin`) | Route files under `admin/src/app/routes/` follow the URL: kebab-case segments plus `__root`, `index`, `route`, `$param` and `_pathless`; `main.tsx` (Vite entry), `router.tsx` and `i18n/navigation.tsx` (wiring, not components) keep their names; `routeTree.gen.ts` is generated | `routes/$locale/admin/tasks.tsx` | The router derives URLs from file paths; the components inside still use PascalCase names | Must |
| Exported component inside `page.tsx` | `Page` suffix | `export default function TasksPage()` | Distinguishes "root component of a route" from an ordinary component when reading code or stack traces | Must |
| Exported component inside `layout.tsx` | `Layout` suffix | `export default function TasksLayout()` | Same: the purpose is visible without opening the file | Must |
| Page component extracted out of `page.tsx` | File `<name>-page.tsx`, export `<Name>Page` | `create-task-page.tsx` exports `CreateTaskPage` | Marks "full-screen content" as opposed to a reusable widget | Should |
| React components | PascalCase | `TaskForm`, `StatusBadge` | Separates components from plain functions at the syntax level (JSX requires a capital letter for custom tags) | Must |
| Hooks | `camelCase`, `use` prefix | `useAuth`, `useTaskFilters` | React contract: only `use*` may call other hooks; the `react-hooks` lint rule keys on the prefix | Must |
| Plain functions / variables | `camelCase` | `loadTokens`, `pageToken` | TS/JS ecosystem standard | Must |
| Types, interfaces, enums | `PascalCase` | `TaskFormValues`, `SettablePriority` | Matches the TypeScript team's and most style guides' convention | Must |
| Module-level constants (immutable, "configuration") | `SCREAMING_SNAKE_CASE` | `SORT_OPTIONS`, `ALL_STATUSES` | Signals "never reassigned, shared across the module" | Should |
| Local `const` that is not configuration | `camelCase` | `const total = data?.total` | Not every `const` is a domain constant; screaming case for locals is noise | Should |
| Module directories (feature slices) | `kebab-case`, singular domain | `apps/web/app/src/modules/tasks/`, `apps/web/app/src/modules/auth/` | Matches kebab-case files inside; removes the "modules vs module" ambiguity | Must |
| Feature directories inside a module | `features/<feature>/{ui,lib}`, `kebab-case`, named after the capability, not after a component | `apps/web/app/src/modules/tasks/features/list/ui/task-list.tsx`, `features/bulk-edit/` | One capability per folder; `scripts/check-feature-boundaries.sh` rejects any other child than `ui/` and `lib/` and any import between features | Must |
| Test files | `<file>.test.tsx` / `<file>.test.ts` next to the source; a test that spans several features sits in the module root | `task-form.test.tsx`, `modules/tasks/tasks-offline.test.tsx` | Vitest default resolution; a co-located test is visible in the tree | Must |
| i18n keys and message JSON files | `camelCase` keys, file named by locale code | `en.json`, `{"titleLabel": "..."}` | Matches the JS object they load into; locale is lowercase BCP-47 (Tajik uses the directory/file `tj`, see docs/content/i18n.md) | Must |
| CSS classes (Tailwind is an exception) | Utility classes as is, do not rename | `className="flex flex-col gap-2"` | Tailwind is a third-party API, not our naming | Could |

**Enforcement.** Biome `useFilenamingConvention` (`filenameCases: ["kebab-case"]`) and `useNamingConvention` fail `pnpm lint`; `scripts/check-naming.sh` additionally requires a kebab-case name for every `.ts` / `.tsx` source file under `apps/web/shared` and `apps/web/{app,admin,landing}/src`, including `shared/ui` (shadcn/ui primitives: `button.tsx`, `alert-dialog.tsx`, ...), tests and stories (`task-form.test.tsx`, `task-form.stories.tsx`). The only other names are the framework ones in the table (Next.js files, TanStack Router route files, the generated `routeTree.gen.ts`). Provider and boundary components follow the same rule: `auth-provider.tsx`, `error-boundary.tsx`, `query-provider.tsx`.

## Anti-patterns

```
// BAD apps/web/app/src/modules/tasks/features/list/ui/TaskList.tsx  - PascalCase file name; the file is task-list.tsx, the component is TaskList
// BAD apps/web/app/src/modules/tasks/features/list/ui/taskList.tsx  - camelCase file name instead of kebab-case
// BAD apps/web/app/src/modules/tasks/features/list/components/      - a feature holds only ui/ and lib/
// BAD export function taskList()                 - a component must be PascalCase: TaskList
// BAD export default function TasksPage()       - correct name, but file is tasks.tsx instead of page.tsx (route will not work)
// BAD const MAX_retries = 3;                     - mixed case in one identifier
// BAD interface taskFormValues { ... }           - type must be PascalCase: TaskFormValues
```
