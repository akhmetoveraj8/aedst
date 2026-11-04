import { describe, expect, it } from "vitest";

import {
  splitHighlights,
  stripHighlights,
} from "@/modules/search/lib/highlight";

const S = "";
const E = "";

describe("splitHighlights", () => {
  it("splits plain and matched runs", () => {
    expect(splitHighlights(`Write ${S}docs${E} for ${S}search${E}`)).toEqual([
      { text: "Write ", match: false },
      { text: "docs", match: true },
      { text: " for ", match: false },
      { text: "search", match: true },
    ]);
  });

  it("handles a snippet with no matches or only a match", () => {
    expect(splitHighlights("plain")).toEqual([{ text: "plain", match: false }]);
    expect(splitHighlights(`${S}all${E}`)).toEqual([
      { text: "all", match: true },
    ]);
    expect(splitHighlights("")).toEqual([]);
  });

  it("degrades unbalanced or stray markers to plain text", () => {
    expect(splitHighlights(`open ${S}never closed`)).toEqual([
      { text: "open never closed", match: false },
    ]);
    expect(splitHighlights(`stray${E} end`)).toEqual([
      { text: "stray end", match: false },
    ]);
  });

  it("never interprets markup", () => {
    expect(splitHighlights(`${S}<img onerror=x>${E}`)).toEqual([
      { text: "<img onerror=x>", match: true },
    ]);
  });
});

describe("stripHighlights", () => {
  it("removes every marker", () => {
    expect(stripHighlights(`a ${S}b${E} c`)).toBe("a b c");
  });
});
