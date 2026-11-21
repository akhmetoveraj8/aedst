---
title: Validation boundary
description: Which layer validates what on the web (Protovalidate, Zod, React Hook Form), where each import is allowed, and the gates that enforce it.
---

# Validation boundary

The web has three tools that all look like "validation". Each has exactly one job. The server is always the final authority.

| Layer | Job | Never |
|---|---|---|
| **Protovalidate** (`@bufbuild/protovalidate`, rules in the `.proto`) | Rules of every value that becomes an API message | Used outside `shared/lib/forms` |
| **Zod** (`zod/mini` in code that ships to the browser, full `zod` on the server) | Rules of data that is NOT an API message: env, storage payloads, route-handler input that is not a proto message, URL parameters a nuqs parser cannot express | The rule source of a form that submits an API message |
| **React Hook Form** | Form state: values, dirty/touched, submit, error display | Holding a rule (`required`, `minLength`, `pattern`, `validate`, ...) |

## Decision table

| What is validated | Where the rule lives | How it runs |
|---|---|---|
| A form that submits an API message (create task, broadcast, delete reason) | The `.proto` field annotation (`buf.validate`) | `useForm({ resolver: protovalidateResolver(Schema, { toMessage, fieldMap?, omit? }) })` from `@/shared/lib/forms/protovalidate-resolver` |
| A UI-only field of such a form (confirm checkbox, local filter text) | Not validated by a rule; if it must be, it becomes a proto field or the form is client-only (next row) | `omit` lists message fields the form does not collect |
| A client-only form (no API message) | A Zod schema in the module's `lib/` | `useForm({ resolver: standardSchemaResolver(schema) })` from `@hookform/resolvers/standard-schema` (stock library code, no custom seam; no such form exists yet) |
| URL and search params (filters, sort, tabs) | nuqs parsers (`parseAsStringLiteral`, ...) in `lib/*-search-params.ts`; Zod only if a parser cannot express it | Parsed identically on server and client |
| Env variables | Zod in `shared/env/{client,server,edge}.ts`, `landing/src/env.ts`, `admin/src/app/config/env.ts` | Parsed once at startup, fail fast |
| Storage payloads (`localStorage`, cookies the web owns) | Zod schema in `lib/`, parsed with `safeParse` and a fallback | Never trust stored text |
| Route handlers and Server Actions | Re-validate input (Zod for non-proto input; API calls re-use the server's Protovalidate) | Client validation is a convenience, never a guarantee |
| Business rules, uniqueness, permissions | The server (Go), nowhere else | The web only displays the resulting `ConnectError` |

## Rules

1. One rule, one place. A constraint exists once: in the `.proto` for API messages, in one Zod schema for client-only data. Never both for the same value.
2. React Hook Form is state only. `register("field")` takes the name and nothing else; no `rules=` on `Controller`; every `useForm` passes a `resolver`.
3. A form that submits an API message uses `protovalidateResolver`. Never `standardSchemaResolver` / `zodResolver` for it, and never both resolvers in one file. Form state is not the wire message, so `toMessage` maps values to the message first (trim, dates, optional ids).
4. `@bufbuild/protovalidate` is imported only inside `shared/lib/forms` (it is loaded lazily there so it stays out of initial route JavaScript).
5. Zod is imported only in non-UI code: env files, `lib/`, `shared/lib`, route handlers, server actions. Never in `ui/**`, `shared/ui/**` or a page/layout `.tsx`. A file that uses `protovalidateResolver` does not import Zod.
6. No ad-hoc helpers (`validateTitle`, `isValidEmail`, `*_REGEX`) that restate a proto rule. If a rule is missing, add it to the `.proto` (then `task app:generate`), do not patch the client.
7. The server is the final authority: the client resolver exists for fast feedback. Server `INVALID_ARGUMENT` violations are mapped back to fields, not re-checked.
8. HTML attributes (`maxLength`, `required`, `pattern`) are not used as rules on form controls; they would be a second copy.

## Error messages and i18n

Protovalidate violations carry the rule's `message` (English) and a rule id. The resolver maps each violation to the form field (`fieldMap`: proto camelCase path to form field name) and puts the rule id in the RHF error `type`; the UI picks a translated string from that id (see `titleErrorKey` in `modules/tasks/ui/task-form.tsx`) under the module's `i18n/<locale>.json` namespace (all five locales). Do not display the English proto text to users and do not translate by matching message text. Zod schemas use message keys, not literals, for the same reason.

## Where each import is allowed

| Import | Allowed in | Enforced by |
|---|---|---|
| `@bufbuild/protovalidate` | `shared/lib/forms/**` (and tests) | Biome plugin `no-protovalidate-outside-forms.grit` |
| `@hookform/resolvers` root and every subpath except `standard-schema` | `shared/lib/forms/**`; `@hookform/resolvers/standard-schema` is allowed in feature code for client-only forms | Biome plugin `no-hookform-resolvers-subpath.grit` |
| `zod`, `zod/mini` | env files, `lib/`, `shared/lib`, route handlers, actions; NOT `ui/**`, `shared/ui/**`, `src/app/**/*.tsx` | Biome plugin `no-zod-in-ui.grit` |
| `register(name, { rules })`, `rules=` | nowhere | Biome plugins `no-inline-form-rules.grit`, `no-inline-form-rules-jsx.grit` |
| `useForm` without `resolver`, Zod or `standardSchemaResolver` plus `protovalidateResolver` in one file, `validateX` / `isValidX` / `*_REGEX` helpers | nowhere (exceptions: `ALLOWLIST` with a reason) | `apps/web/app/scripts/check-validation.mjs` (`pnpm check:validation`) |
| `react-hook-form` in every form file | all forms | `pnpm check:forms` |

The Biome plugins and the script cover app, admin and landing (they share `apps/web/biome.json`; the script walks all three plus `shared`). `pnpm check:selftest` proves each gate fails on a broken fixture in `apps/web/app/lint/fixtures`.

## Adding an exception

Only in `ALLOWLIST` of `check-validation.mjs` (file, rule number, reason), reviewed by the owner, and recorded in [decisions/web](/decisions/web). A comment in the code is not an exception.
