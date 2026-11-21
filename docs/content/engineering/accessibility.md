---
title: "Accessibility standard"
description: "WCAG 2.2 AA on every client: the rules new UI must follow, and the gates that check them."
---

# Accessibility standard

Target: **WCAG 2.2 level AA** on every client, in all five locales, in both directions (Arabic is
right-to-left) and in both themes. Accessibility is part of "done", like tests.

## Rules for new UI (every platform)

1. **Use the kit.** Controls come from the UI kit (`ui-kit.yaml`), never from raw elements: the kit
   carries roles, names, focus handling and keyboard behaviour.
2. **Name everything interactive.** A visible label, or an accessible name from the module's catalogue
   (never a hardcoded string) for icon-only controls. Inputs have a label, a described error and
   `autocomplete` where the platform has a token for the field.
3. **Keyboard and switch access.** Every action is reachable and operable without a pointer; focus order
   follows reading order; focus is visible, is never trapped outside a modal, moves into a dialog when
   it opens and returns to the trigger when it closes.
4. **Do not rely on colour.** State is carried by text or an icon as well. Text contrast is at least
   4.5:1 (3:1 for large text and for control boundaries); colours come from design tokens, which are
   contrast-checked, never from literals.
5. **Targets and zoom.** Pointer targets are at least 24 by 24 CSS pixels (44 pt on touch platforms);
   layouts survive 200% text size and a 320 CSS pixel width without horizontal scrolling.
6. **Motion.** Respect reduced-motion; no content flashes; animation is never the only feedback.
7. **Structure.** One `h1` per page, landmarks (`header`, `nav`, `main`, `footer`), a skip link, lists
   and tables marked up as such, `lang` and `dir` set from the locale.
8. **Status and errors.** Async results and validation errors are announced (`aria-live` or the platform
   equivalent) without stealing focus; a form error names the field and how to fix it.
9. **Direction.** Logical properties only (`ms-`, `me-`, `start`, `end`); icons that imply direction
   mirror in right-to-left.
10. **Media.** Content images have alternative text; decorative ones are hidden from assistive
    technology; video has captions.

## Gates

| Platform | Gate | Status (2026-11-21) |
|---|---|---|
| Web `app` | Biome a11y rules; Storybook a11y addon with `test: "error"`; Playwright + axe at WCAG 2.2 AA including right-to-left; Lighthouse accessibility score 1; reduced-motion spec | In CI |
| Web `admin` | Biome a11y rules; Playwright + axe at WCAG 2.2 AA on the overview, task directory, delete dialog, broadcast form, audit log and forbidden page, in both themes and right-to-left (`admin/e2e/accessibility.spec.ts`) | In `admin-ci.yml`; 10 axe tests passed locally |
| Web `landing` | Biome a11y rules; Playwright + axe at WCAG 2.2 AA on every page type, right-to-left, dark theme, the 404 page and an open FAQ answer (`landing/e2e/accessibility.spec.ts`); Lighthouse accessibility score 1 | In `landing-ci.yml`; 8 axe tests passed locally (25 e2e tests in all), Lighthouse accessibility 1 locally |
| Web, all three | No physical direction utilities (`ml-`, `mr-`, `pl-`, `pr-`, `left-`, `right-`, `text-left`, `text-right`) in the projects and `shared/ui`: `pnpm check:source`, allowlist `apps/web/shared/scripts/source-bans-allowlist.json` (empty), negative fixtures in `pnpm check:selftest` | In the three workflows and `task check` |
| Web `shared/ui` | Biome a11y rules (four of the five that were off are on again) and stories with the a11y addon | `useSemanticElements` stays off for the kit: the shadcn primitives set `role="group"`, `role="separator"` and `role="region"` on `div`s by design (8 places). Four inline `biome-ignore` comments carry their reason (breadcrumb current page, input-group addon click, `Label` primitive, one story) |
| Android | Accessibility Test Framework checks in instrumented tests | Frozen, never run |
| Apple | Accessibility audit in UI tests | Frozen, never compiled |
| Desktop | Slint accessible roles and labels; `i-slint-backend-testing` | No screen-reader pass, no Linux check |

The first axe runs on `admin` and `landing` (2026-11-21) found and fixed four defects: a button nested
in a button in `shared/ui/mode-toggle.tsx`, the destructive button hover tint under 4.5:1, muted text
on a muted background in the landing call-to-action, and the landing 404 for unknown paths rendered
without `lang`. `ModeToggle` takes its labels as props (the kit never hardcodes user-facing text); the
admin passes them from its catalogue in all five locales. On `landing` the FAQ is native `<details>` and
the language picker is a list of links, so keyboard and screen-reader behaviour is the platform's.
