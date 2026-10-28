/** apps/server wraps matched terms in these Private Use Area characters. */

const HIGHLIGHT_START = "";
const HIGHLIGHT_END = "";

export type HighlightSegment = { text: string; match: boolean };

/**
 * Splits a search snippet into plain and matched runs. The markers are
 * plain characters (not HTML), so rendering stays text-only — no
 * `dangerouslySetInnerHTML`, nothing for an attacker-controlled title to
 * inject. Unbalanced markers degrade to plain text.
 */
export function splitHighlights(snippet: string): HighlightSegment[] {
  const segments: HighlightSegment[] = [];
  let rest = snippet;
  while (rest.length > 0) {
    const start = rest.indexOf(HIGHLIGHT_START);
    if (start === -1) {
      segments.push({ text: rest, match: false });
      break;
    }
    const end = rest.indexOf(HIGHLIGHT_END, start + 1);
    if (end === -1) {
      segments.push({
        text: rest.replaceAll(HIGHLIGHT_START, ""),
        match: false,
      });
      break;
    }
    if (start > 0) {
      segments.push({ text: rest.slice(0, start), match: false });
    }
    const matched = rest.slice(start + 1, end);
    if (matched) {
      segments.push({ text: matched, match: true });
    }
    rest = rest.slice(end + 1);
  }
  // Stray end markers never render.
  return segments
    .map((segment) => ({
      ...segment,
      text: segment.text.replaceAll(HIGHLIGHT_END, ""),
    }))
    .filter((segment) => segment.text.length > 0);
}

/** The snippet as plain text (markers removed), e.g. for `aria-label`. */
export function stripHighlights(snippet: string): string {
  return snippet.replaceAll(HIGHLIGHT_START, "").replaceAll(HIGHLIGHT_END, "");
}
