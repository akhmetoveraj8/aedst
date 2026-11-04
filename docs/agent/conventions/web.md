# Naming: Web (TypeScript / React / Next.js, `apps/web`: `shared`, `app`, `admin`, `landing`)

Part of [CONVENTIONS.md](../../../CONVENTIONS.md). The same rules apply in all four web directories. Levels: **Must** = enforced (linter/CI), **Should** = needs a one-line PR justification to deviate, **Could** = preference.

| What | Rule | Example | Why | Level |
|---|---|---|---|---|
| Plain files (utilities, hooks, config, scripts) | `kebab-case.ts` | `token-storage.ts`, `use-auth.ts` | Matches Next.js kebab-case routes and npm package names; uniform on every filesystem | Must |
| React component files (not framework files) | `PascalCase.tsx`, file name = default export name | `TaskList.tsx`, `DashboardStats.tsx` | A component is a UI type/factory, not a utility; PascalCase says "React component" at a glance in the file tree | Must |
| Framework-mandated files (Next.js App Router) | Exactly `page.tsx`, `layout.tsx`, `loading.tsx`, `error.tsx`, `not-found.tsx`, `route.ts`; the name cannot change | `app/(pages)/[locale]/tasks/page.tsx` | Next.js resolves routing by these literal names; this is a framework contract, not a naming violation | Must |
| Framework-mandated files (TanStack Router, `admin`) | Route files under `admin/src/app/routes/` follow the URL: kebab-case segments plus `__root`, `index`, `route`, `$param` and `_pathless`; `main.tsx` (Vite entry), `router.tsx` and `i18n/navigation.tsx` (wiring, not components) keep their names; `routeTree.gen.ts` is generated | `routes/$locale/admin/tasks.tsx` | The router derives URLs from file paths; the components inside still use PascalCase names | Must |
| Exported component inside `page.tsx` | `Page` suffix | `export default function TasksPage()` | Distinguishes "root component of a route" from an ordinary component when reading code or stack traces | Must |
| Exported component inside `layout.tsx` | `Layout` suffix | `export default function TasksLayout()` | Same: the purpose is visible without opening the file | Must |
| Page component extracted out of `page.tsx` | File `<Name>Page.tsx`, export `<Name>Page` | `CreateTaskPage.tsx` | Marks "full-screen content" as opposed to a reusable widget | Should |
| React components | PascalCase | `TaskForm`, `StatusBadge` | Separates components from plain functions at the syntax level (JSX requires a capital letter for custom tags) | Must |
| Hooks | `camelCase`, `use` prefix | `useAuth`, `useTaskFilters` | React contract: only `use*` may call other hooks; the `react-hooks` lint rule keys on the prefix | Must |
| Plain functions / variables | `camelCase` | `loadTokens`, `pageToken` | TS/JS ecosystem standard | Must |
| Types, interfaces, enums | `PascalCase` | `TaskFormValues`, `SettablePriority` | Matches the TypeScript team's and most style guides' convention | Must |
| Module-level constants (immutable, "configuration") | `SCREAMING_SNAKE_CASE` | `SORT_OPTIONS`, `ALL_STATUSES` | Signals "never reassigned, shared across the module" | Should |
| Local `const` that is not configuration | `camelCase` | `const total = data?.total` | Not every `const` is a domain constant; screaming case for locals is noise | Should |
| Module directories (feature slices) | `kebab-case`, singular domain | `apps/web/app/src/modules/tasks/`, `apps/web/app/src/modules/auth/` | Matches kebab-case files inside; removes the "modules vs module" ambiguity | Must |
| Test files | `<file>.test.tsx` / `<file>.test.ts` next to the source | `TaskForm.test.tsx` | Vitest default resolution; a co-located test is visible in the tree | Must |
| i18n keys and message JSON files | `camelCase` keys, file named by locale code | `en.json`, `{"titleLabel": "..."}` | Matches the JS object they load into; locale is lowercase BCP-47 (Tajik uses the directory/file `tj`, see docs/content/i18n.md) | Must |
| CSS classes (Tailwind is an exception) | Utility classes as is, do not rename | `className="flex flex-col gap-2"` | Tailwind is a third-party API, not our naming | Could |

**Enforcement.** Biome `useFilenamingConvention` (kebab-case, plus PascalCase for `.tsx`) and `useNamingConvention` fail `pnpm lint`; `scripts/check-naming.sh` additionally requires `PascalCase.tsx` for every `apps/web/src/**/*.tsx` outside `shared/ui`, `apps/web/app/src/test` and the Next.js framework names (a `.test.tsx` follows its subject; a kebab-case test is accepted only next to a plain `.ts` subject), and `kebab-case.ts` for every other source file. Provider and boundary components are components: `AuthProvider.tsx`, `ErrorBoundary.tsx`, `QueryProvider.tsx`.

**Known exception (documented technical debt):** `apps/web/shared/ui/*` (shadcn/ui-generated primitives: `button.tsx`, `alert-dialog.tsx`, ...) stay `kebab-case.tsx` because the `shadcn` CLI generates them and regeneration would conflict on update. New files in `shared/ui/` are kebab-case too (Must, local exception). Everything else follows the table.

## Anti-patterns

```
// BAD apps/web/app/src/modules/tasks/ui/taskList.tsx        - camelCase instead of PascalCase for a component
// BAD apps/web/app/src/modules/tasks/ui/TaskList.utils.ts    - a utility must not be PascalCase
// BAD export default function TasksPage()       - correct name, but file is Tasks.tsx instead of page.tsx (route will not work)
// BAD const MAX_retries = 3;                     - mixed case in one identifier
// BAD interface taskFormValues { ... }           - type must be PascalCase: TaskFormValues
```
