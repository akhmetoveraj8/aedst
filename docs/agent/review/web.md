# AI review prompt: apps/web

Review the pull request diff under `apps/web/` (a workspace of four directories: `shared`, `app`, `admin`, `landing`). Report findings only; do not push fixes.

## Read first

1. `apps/web/AGENTS.md` (which project owns what) and the `AGENTS.md` of the project the diff touches (`apps/web/app/AGENTS.md`: forms, requests, dates, URL state, UI state, analytics)
2. `docs/content/library-first/web.md` (approved stack, explicit rejections)
3. `docs/content/decisions/web.md` (recorded decisions; do not accept a contradicting change)
4. `docs/agent/conventions/web.md` (naming) and `docs/content/ui-kit.md` (UI elements come only from `apps/web/shared/ui/`)

## Also check

- The change lives in the right project: signed-in end-user feature in `app`, staff-only operation in `admin`, anonymous marketing/SEO page in `landing`, code used by two or more projects and not product-specific in `shared`. No project imports another project's `src`; `shared` imports no project (`docs/content/web/projects.md`).
- Versions are not written in any `package.json`: they say `"catalog:"` and the version lives once in `apps/web/pnpm-workspace.yaml`.
- Forms use React Hook Form with the protovalidate resolver; server calls go through the generated Connect client and TanStack Query, with no raw `fetch` in modules.
- No ESLint or Prettier config, no RxJS, no new third-party origin without a CSP update in `apps/web/app/next.config.ts`.
- No color literals in hand-written UI code (`scripts/check-color-literals.mjs`) and all five locales stay in parity (`scripts/check-i18n-parity.mjs`).
- Generated files (`apps/web/shared/api/connect/generated/**`, `packages/design-tokens/dist/**`) are not hand-edited.
- New dependencies are in the knip allowlist (`apps/web/app/knip.jsonc`) and in `docs/content/library-first/web.md`.
- Engineering standard (`docs/agent/quality-bar.md`; full pages in `docs/content/engineering/`): React 19.3 / Next 16.4 / TypeScript 7 idioms from `docs/content/engineering/modern-language.md` (no manual memoization under the React Compiler, no `unstable_` or experimental flags), the frontend rules in `docs/content/engineering/performance.md` (Server Components first, lazy-loaded heavy UI, `next/image` and `next/font` only, budgets in `apps/web/app/bundle-budget.json` and `apps/web/app/lighthouserc.json` not raised without a reason), and the output and input rows of `docs/content/engineering/security.md`.

Post findings as a PR review. If nothing applies, approve with no comments.
