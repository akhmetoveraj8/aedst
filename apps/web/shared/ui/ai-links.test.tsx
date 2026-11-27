import { render, screen } from "@testing-library/react";
import { describe, expect, it } from "vitest";

import { AiInlineCitationSource } from "@/shared/ui/ai-inline-citation";
import { AiSource, AiSources, AiSourcesContent } from "@/shared/ui/ai-sources";
import {
  AiStackTraceFrames,
  parseStackTrace,
} from "@/shared/ui/ai-stack-trace";
import { renderWithProviders } from "@/test/render";

const HOSTILE = "javascript:alert(document.cookie)";

describe("links built from props", () => {
  it("AiSource renders a safe external link with noopener noreferrer", () => {
    render(
      <AiSources defaultOpen>
        <AiSourcesContent>
          <AiSource href="https://example.com/a" title="Example" />
        </AiSourcesContent>
      </AiSources>,
    );
    const link = screen.getByRole("link", { name: /Example/ });
    expect(link).toHaveAttribute("href", "https://example.com/a");
    expect(link).toHaveAttribute("target", "_blank");
    expect(link).toHaveAttribute("rel", "noopener noreferrer");
  });

  it("AiSource drops a hostile href and renders plain text", () => {
    render(
      <AiSources defaultOpen>
        <AiSourcesContent>
          <AiSource href={HOSTILE} title="Evil" />
        </AiSourcesContent>
      </AiSources>,
    );
    expect(screen.queryByRole("link")).toBeNull();
    expect(screen.getByText("Evil")).toBeInTheDocument();
  });

  it("AiInlineCitationSource never links javascript: or data: URLs", () => {
    const { rerender } = render(
      <AiInlineCitationSource url={HOSTILE} title="Evil" />,
    );
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<AiInlineCitationSource url="data:text/html,x" title="Evil" />);
    expect(screen.queryByRole("link")).toBeNull();
    rerender(<AiInlineCitationSource url="https://example.com" title="Ok" />);
    expect(screen.getByRole("link")).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
  });

  it("AiStackTraceFrames ignores an unsafe getFrameHref result", () => {
    const { frames } = parseStackTrace(
      "Error: boom\n    at run (/app/src/a.ts:1:2)",
    );
    renderWithProviders(
      <AiStackTraceFrames
        frames={frames}
        getFrameHref={() => HOSTILE}
        internalFramesLabel="internal"
        copyLabel="copy"
        copiedLabel="copied"
      />,
    );
    expect(screen.queryByRole("link")).toBeNull();
  });
});
