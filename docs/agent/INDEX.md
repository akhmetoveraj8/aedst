# Agent index: read the least that applies

Start here. Open only the rows for the platform and task at hand; do not read the whole docs tree.

## Always (small)

| File | Why |
|---|---|
| [`AGENTS.md`](../../AGENTS.md) | The one rule and the process rules (under 80 lines) |
| [`CONVENTIONS.md`](../../CONVENTIONS.md) | Naming summary, file-size policy, review checklist (under 8 KB) |

## By platform (open only yours)

| Platform | Naming rules | Approved stack | Decisions (why, revisit when) | App rules |
|---|---|---|---|---|
| Web (router: which project owns what) | [conventions/web.md](conventions/web.md) | [library-first/web](../content/library-first/web.md) | [decisions/web](../content/decisions/web.md) | [`apps/web/AGENTS.md`](../../apps/web/AGENTS.md), [web/projects](../content/web/projects.md) |
| Web-app (signed-in product) | [conventions/web.md](conventions/web.md) | [library-first/web](../content/library-first/web.md) | [decisions/web](../content/decisions/web.md) | [`apps/web/app/AGENTS.md`](../../apps/web/app/AGENTS.md) |
| Web-admin (staff panel) | [conventions/web.md](conventions/web.md) | [library-first/web](../content/library-first/web.md) | [decisions/web](../content/decisions/web.md) | [`apps/web/admin/AGENTS.md`](../../apps/web/admin/AGENTS.md) |
| Web-landing (marketing site) | [conventions/web.md](conventions/web.md) | [library-first/web](../content/library-first/web.md) | [decisions/web](../content/decisions/web.md) | [`apps/web/landing/AGENTS.md`](../../apps/web/landing/AGENTS.md) |
| Server | [conventions/server.md](conventions/server.md) | [library-first/server](../content/library-first/server.md) | [decisions/server](../content/decisions/server.md), `apps/server/docs/adr/` | [`apps/server/AGENTS.md`](../../apps/server/AGENTS.md) |
| Android | [conventions/android.md](conventions/android.md) | [library-first/android](../content/library-first/android.md) | [decisions/android](../content/decisions/android.md) | [`apps/android/AGENTS.md`](../../apps/android/AGENTS.md) |
| Apple | [conventions/apple.md](conventions/apple.md) | [library-first/apple](../content/library-first/apple.md) | [decisions/apple](../content/decisions/apple.md) | [`apps/apple/AGENTS.md`](../../apps/apple/AGENTS.md) |
| Desktop | [conventions/desktop.md](conventions/desktop.md) | [library-first/desktop](../content/library-first/desktop.md) | [decisions/desktop](../content/decisions/desktop.md), `apps/desktop/docs/adr/` | [`apps/desktop/AGENTS.md`](../../apps/desktop/AGENTS.md), `CODING_STANDARDS.md` |

Web is a workspace of four directories (`shared`, `app`, `admin`, `landing`): start at `apps/web/AGENTS.md`, pick ONE project, then read that project's `AGENTS.md`. Each app has a situational `AGENTS.md` (the web, Android, Apple and Desktop ones stay at 80 lines or fewer, plus Next.js's generated block on web): "when you add a form / screen / RPC call / string / setting / offline write, use X, copy file Y, test Z, run gate W". Read it before touching that app; `README.md`, `CONTRIBUTING.md` and `CODING_STANDARDS.md` of an app are background, not the entry point.

## By task

| Task | Read |
|---|---|
| Adding a dependency or writing a new utility | [library-first/general](../content/library-first/general.md) (order of preference, version policy, rejections, Definition of Done), then the platform stack page |
| Proposing an architectural change | [decisions index](../content/decisions.md), then the platform decision page; do not re-propose recorded items |
| Naming a file/type/resource | The platform file in `conventions/`; linter shapes in [conventions/tooling.md](conventions/tooling.md) |
| UI component or color | [ui-kit](../content/ui-kit.md) (parity matrix, generated tokens); never hand-edit generated token files |
| User-facing strings | [i18n](../content/i18n.md) (locales en/ru/tg/uz/ar, key mapping, parity script) |
| A file grows past 300 lines | Split it; see "File size" in [`CONVENTIONS.md`](../../CONVENTIONS.md) |
| First push, cloning the template, GitHub-side settings and secrets | [github-setup.md](github-setup.md) |
| Adding a feature module (new vertical slice on all platforms) | [new-module.md](new-module.md): `task new:module -- NAME=<id>` |
| The same feature on all four clients (eight steps, file per platform, web ui/lib mapping, unknown-enum and list-query rules) | [client-recipe](../content/client-recipe.md); reference behaviour spec: [features/tasks](../content/features/tasks.md) |
| Which web project a change belongs in (app / admin / landing / shared), dependency direction, auth between app and admin | [web/projects](../content/web/projects.md) |
| SEO, GEO (AI crawlers, llms.txt, JSON-LD, canonical) of the web app | [web/seo-geo](../content/web/seo-geo.md) |
| Deploying a web project (container, Helm, Sentry source maps, Vercel alternative) | [web/deployment](../content/web/deployment.md) |
| Claiming something works | [Platform status](../content/status.md): what has actually been built and run |
| Full rules text and forbidden list | [rules.md](rules.md) |

## Commands (single entry point: `task`)

`task --list`, `task doctor` (what this machine can verify), `task verify:<platform>` (exact commands), `task check` (cheap cross-platform checks: naming, file size, colors, i18n, boundaries, knip, migrations, tokens).

## Claude Code layer

`.claude/settings.json` denies destructive commands and `.env` access (Read, Edit and the common Bash readers), asks before git history changes, injects the verification status at SessionStart (`AEDST_SESSION_START=off` silences it), refuses edits to generated files, lock files and real `.env` files (PreToolUse), formats edited files by app (PostToolUse) and runs `task check` plus the touched apps' lint before a session stops (Stop; `AEDST_STOP_GATE=off` skips it, `AEDST_STOP_GATE_TIMEOUT` caps each check). Scripts are in `.claude/hooks/`; `task check:hooks` smoke-tests them.

Skills (`.claude/skills/`): `write-spec` (spec, approval gate, Definition of Done), `new-module`, `client-recipe`, `add-dependency`, `verify-status`, `review-platform`. Read-only review subagents (`.claude/agents/`): `server-`, `web-`, `android-`, `apple-`, `desktop-reviewer`; each applies `docs/agent/review/<platform>.md`, the same file CI uses.

## Do not read

`docs/archive/` is historical material (an original brief, partly in Russian) and is not a source of requirements. Do not read it for tasks.
