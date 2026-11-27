/**
 * Link-safety helper for URLs that come from data (model output, API
 * payloads, user input) and end up in an `href`. Uses only the platform `URL`
 * API. Allowed: `http:`, `https:`, `mailto:`, and relative references that
 * cannot be read as another scheme or host (`/path`, `./x`, `../x`, `?q`, `#h`).
 * Everything else (`javascript:`, `data:`, `vbscript:`, `file:`, `blob:`,
 * protocol-relative `//host`, control characters, backslash tricks) is
 * rejected.
 */

const ALLOWED_PROTOCOLS = new Set(["http:", "https:", "mailto:"]);

// Code points that must never appear inside a link: C0/C1 controls, DEL, any
// whitespace (the URL parser silently drops tab, CR and LF inside a scheme:
// the classic `java<TAB>script:` bypass), the BOM, and zero-width or bidi
// characters that can hide inside a scheme or host. Compared by code point so
// the source holds no invisible characters.
const BLOCKED_RANGES: readonly (readonly [number, number])[] = [
  [0x0000, 0x0020],
  [0x007f, 0x009f],
  [0x200b, 0x200f],
  [0x2028, 0x202e],
  [0x2060, 0x2064],
  [0x2066, 0x2069],
  [0xfeff, 0xfeff],
];

function hasBlockedCharacter(value: string): boolean {
  for (const char of value) {
    const code = char.codePointAt(0) ?? 0;
    if (BLOCKED_RANGES.some(([from, to]) => code >= from && code <= to)) {
      return true;
    }
  }
  return false;
}

const PROBE_BASE = "https://safe-href.invalid";

/**
 * Returns a normalised URL string that is safe to put in an `href`, or
 * `undefined` when it is not. Render a non-link element for `undefined`.
 */
function safeHref(input: string | null | undefined): string | undefined {
  if (typeof input !== "string") return undefined;
  // Browsers strip leading/trailing whitespace, so trim it here too, but
  // whitespace or controls INSIDE the value are refused.
  const value = input.trim();
  if (value === "") return undefined;
  if (hasBlockedCharacter(value)) return undefined;
  if (value.includes("\\")) return undefined;
  // `//host` and `///host` inherit the page scheme: a different origin.
  if (value.startsWith("//")) return undefined;

  let parsed: URL;
  try {
    parsed = new URL(value);
  } catch {
    return isSafeRelative(value) ? value : undefined;
  }
  if (!ALLOWED_PROTOCOLS.has(parsed.protocol)) return undefined;
  if (parsed.protocol !== "mailto:" && parsed.hostname === "") return undefined;
  if (parsed.username !== "" || parsed.password !== "") return undefined;
  return parsed.href;
}

function isSafeRelative(value: string): boolean {
  // A colon before the first `/ ? #` means the text is a scheme, e.g.
  // `javascript:` that failed absolute parsing, or `foo:bar`.
  const firstDelimiter = value.search(/[/?#]/u);
  const head = firstDelimiter === -1 ? value : value.slice(0, firstDelimiter);
  if (head.includes(":")) return false;
  try {
    return new URL(value, PROBE_BASE).origin === PROBE_BASE;
  } catch {
    return false;
  }
}

/** `rel` for every link that opens a new browsing context. */
const EXTERNAL_LINK_REL = "noopener noreferrer";

export { EXTERNAL_LINK_REL, safeHref };
