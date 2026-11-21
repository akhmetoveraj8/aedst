// Reads enum declarations from Kotlin, Swift and Slint source without a parser dependency, and maps
// them to the variant axes of ui-kit.yaml. Used by check-ui-kit.mjs for the native kits, the way
// cva.mjs is used for web.

/** `icon-sm`, `ICON_SM` and `iconSm` are the same name. */
export const normalise = (name) => name.toLowerCase().replace(/[^a-z0-9]/g, '');

/** Source with comments blanked out (same length, so indexes stay valid). `://` in a URL is kept. */
function stripComments(src) {
  const blank = (m) => m.replace(/[^\n]/g, ' ');
  return src.replace(/\/\*[\s\S]*?\*\//g, blank).replace(/(^|[^:"'])\/\/[^\n]*/g, (m, lead) => lead + blank(m.slice(lead.length)));
}

/** Index of the bracket that closes the one opened at `open`, or -1. */
function matchClose(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if ('{[('.includes(src[i])) depth++;
    else if ('}])'.includes(src[i]) && --depth === 0) return i;
  }
  return -1;
}

/** `text` split at the commas that are not inside brackets. */
function splitTopLevel(text) {
  const parts = [];
  let depth = 0;
  let start = 0;
  for (let i = 0; i < text.length; i++) {
    if ('{[('.includes(text[i])) depth++;
    else if ('}])'.includes(text[i])) depth--;
    else if (text[i] === ',' && depth === 0) { parts.push(text.slice(start, i)); start = i + 1; }
  }
  parts.push(text.slice(start));
  return parts;
}

/** Leading identifier of each comma-separated part (annotations and backticks dropped). */
const identifiers = (text) =>
  splitTopLevel(text).map((part) => /^(?:\s*@\w+(?:\([^)]*\))?)*\s*`?([A-Za-z_][\w-]*)`?/.exec(part)?.[1]).filter(Boolean);

/** Kotlin: the constants are the entries before the first top-level `;` of the body. */
function kotlinConstants(body) {
  let depth = 0;
  let end = body.length;
  for (let i = 0; i < body.length; i++) {
    if ('{[('.includes(body[i])) depth++;
    else if ('}])'.includes(body[i])) depth--;
    else if (body[i] === ';' && depth === 0) { end = i; break; }
  }
  return identifiers(body.slice(0, end));
}

/** Swift: every `case a, b` line directly in the body (a `switch` inside a member is deeper). */
function swiftCases(body) {
  const names = [];
  let depth = 0;
  for (let i = 0; i < body.length; i++) {
    if ('{[('.includes(body[i])) depth++;
    else if ('}])'.includes(body[i])) depth--;
    else if (depth === 0 && /^case\s/.test(body.slice(i, i + 5)) && !/[\w.]/.test(body[i - 1] ?? ' ')) {
      const eol = body.indexOf('\n', i);
      const line = body.slice(i + 5, eol === -1 ? body.length : eol);
      names.push(...identifiers(line));
      i += 4 + line.length;
    }
  }
  return names;
}

const LANGUAGES = {
  '.kt': { head: /\benum\s+class\s+(\w+)/g, values: kotlinConstants },
  '.swift': { head: /\benum\s+(\w+)/g, values: swiftCases },
  '.slint': { head: /\benum\s+(\w+)/g, values: (body) => identifiers(body) },
};

/**
 * Enums declared in `src`: [{ name, values }], in source order, nested ones included.
 * `ext` selects the language (`.kt`, `.swift`, `.slint`); an enum without constants is skipped.
 */
export function enumDeclarations(src, ext) {
  const lang = LANGUAGES[ext];
  if (!lang) return [];
  const code = stripComments(src);
  const found = [];
  for (const m of code.matchAll(lang.head)) {
    let open = m.index + m[0].length;
    while (open < code.length && /\s/.test(code[open])) open++;
    if (code[open] === '(') open = matchClose(code, open) + 1; // Kotlin constructor
    open = code.indexOf('{', open);
    const close = open === -1 ? -1 : matchClose(code, open);
    if (close === -1) continue;
    const values = lang.values(code.slice(open + 1, close));
    if (values.length) found.push({ name: m[1], values });
  }
  return found;
}

/**
 * Values of one axis in a native kit file: the union of every enum whose name ends with the axis
 * name (`variant` matches `AedstItemVariant` and `AedstItemMediaVariant`, as web unions its `cva`
 * calls). null when the file declares no such enum.
 */
export function enumAxis(declarations, axis) {
  const matching = declarations.filter((d) => normalise(d.name).endsWith(normalise(axis)));
  if (!matching.length) return null;
  return [...new Set(matching.flatMap((d) => d.values))];
}
