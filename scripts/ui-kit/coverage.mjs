// Behaviour checks of ui-kit.yaml beyond the file tree (used by scripts/check-ui-kit.mjs):
//   coverage  every implemented component is exercised on its platform: named in a story or test (web), a
//             unit/UI test (Android, Apple) or a compiled gallery page or UI test (Desktop). The roots come
//             from `coverage:` in the manifest.
//   props     the API contract: every name in a component's `props:` is a parameter of each platform's file
//             (names compare case-insensitively with separators ignored: `onOpenChange` == `on-open-change`).
import { existsSync, readdirSync, readFileSync, statSync } from 'node:fs';
import path from 'node:path';
import { normalise } from './enums.mjs';

function walk(abs) {
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [abs];
  return readdirSync(abs, { withFileTypes: true }).flatMap((e) => walk(path.join(abs, e.name)));
}

/** Text of every coverage file of a platform, read once. */
export function coverageText(root, rule) {
  if (!rule) return null;
  const suffixes = rule.suffix ?? [];
  return (rule.roots ?? [])
    .flatMap((r) => walk(path.join(root, r)))
    .filter((f) => suffixes.some((s) => f.endsWith(s)))
    .map((f) => readFileSync(f, 'utf8'))
    .join('\n');
}

/** The symbol a component file declares: `AedstAccordion.kt` -> AedstAccordion; `aedst_alert.slint` -> AedstAlert. */
export function componentSymbol(file) {
  const base = path.basename(file).replace(/\.(kt|swift|slint|tsx)$/, '');
  if (!base.includes('_') && !base.includes('-')) return base;
  return base.split(/[_-]/).map((s) => s.charAt(0).toUpperCase() + s.slice(1)).join('');
}

/** Every exported symbol of a native kit file (components, structs, enums), so a gallery that uses any of them counts. */
function declaredSymbols(src) {
  const re = /\b(?:export\s+(?:component|struct|enum|global)|(?:public\s+)?(?:struct|enum|class|final class)|fun|enum class|data class)\s+(Aedst[A-Za-z0-9]+)/g;
  return [...new Set([...src.matchAll(re)].map((m) => m[1]))];
}

export function isCovered(text, file, src) {
  if (text === null) return true;
  const symbols = new Set([componentSymbol(file), ...declaredSymbols(src)]);
  // Case-insensitive: web exports `InputOTP` from `input-otp.tsx`.
  return [...symbols].some((s) => new RegExp(`\\b${s}\\b`, 'i').test(text));
}

/** Identifiers of a source file, normalised, for the props contract. */
export function identifiers(src) {
  return new Set([...src.matchAll(/[A-Za-z_][A-Za-z0-9_-]*/g)].map((m) => normalise(m[0])));
}

export function missingProps(props, src) {
  const ids = identifiers(src);
  return (props ?? []).filter((p) => !ids.has(normalise(p)));
}

/** A web prop typed as a string-literal union: `size?: "default" | "sm" | "lg"` -> [default, sm, lg]. */
export function propUnion(src, prop) {
  const m = src.match(new RegExp(`\\b${prop}\\??\\s*:\\s*((?:"[^"]+"\\s*\\|\\s*)+"[^"]+")`));
  return m ? [...m[1].matchAll(/"([^"]+)"/g)].map((x) => x[1]) : null;
}
