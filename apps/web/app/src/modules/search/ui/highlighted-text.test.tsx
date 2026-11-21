import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { HighlightedText } from "@/modules/search/ui/HighlightedText";

// apps/server wraps matched terms in these Private Use Area characters.
const START = "";
const END = "";

describe("HighlightedText", () => {
  it("wraps matched terms in <mark> and leaves the rest as plain text", () => {
    const { container } = render(
      <HighlightedText text={`Fix the ${START}login${END} bug`} />,
    );

    const marks = container.querySelectorAll("mark");
    expect(marks).toHaveLength(1);
    expect(marks[0]).toHaveTextContent("login");
    expect(container).toHaveTextContent("Fix the login bug");
  });

  it("marks every match", () => {
    render(<HighlightedText text={`${START}a${END} b ${START}c${END}`} />);

    expect(screen.getAllByText(/^[ac]$/).map((node) => node.tagName)).toEqual([
      "MARK",
      "MARK",
    ]);
  });

  it("renders plain text without any marker untouched", () => {
    const { container } = render(<HighlightedText text="Nothing to see" />);

    expect(container.querySelector("mark")).toBeNull();
    expect(container).toHaveTextContent("Nothing to see");
  });

  it("never interprets HTML in a snippet: it stays text", () => {
    const { container } = render(
      <HighlightedText text={`<img src=x onerror=alert(1)> ${START}x${END}`} />,
    );

    expect(container.querySelector("img")).toBeNull();
    expect(container).toHaveTextContent("<img src=x onerror=alert(1)> x");
  });

  it("drops an unbalanced marker instead of rendering it", () => {
    const { container } = render(
      <HighlightedText text={`broken ${START}run`} />,
    );

    expect(container.querySelector("mark")).toBeNull();
    expect(container).toHaveTextContent("broken run");
  });
});
