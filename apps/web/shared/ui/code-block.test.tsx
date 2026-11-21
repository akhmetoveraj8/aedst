import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, describe, expect, it, vi } from "vitest";

import { CodeBlock } from "@/shared/ui/code-block";

const code = "const a = 1;\nconst b = 2;\n";

afterEach(() => {
  vi.restoreAllMocks();
});

describe("CodeBlock", () => {
  it("renders left-to-right code with line numbers and highlighted lines", () => {
    const { container } = render(
      <CodeBlock code={code} showLineNumbers highlightLines={[2]} />,
    );
    const pre = container.querySelector("pre");
    expect(pre).toHaveAttribute("dir", "ltr");
    expect(pre).toHaveTextContent("const a = 1;");

    const lines = container.querySelectorAll("[data-slot=code-block-line]");
    expect(lines).toHaveLength(2);
    expect(lines[0]).not.toHaveAttribute("data-highlighted");
    expect(lines[1]).toHaveAttribute("data-highlighted");
    // No header without a file name, language or labelled controls.
    expect(screen.queryByRole("button")).not.toBeInTheDocument();
  });

  it("copies the code through the Clipboard API and announces it", async () => {
    // user-event installs its own clipboard stub in setup(); spy after it.
    const user = userEvent.setup();
    const writeText = vi
      .spyOn(navigator.clipboard, "writeText")
      .mockResolvedValue();
    render(
      <CodeBlock code={code} copyLabel="Copy code" copiedLabel="Copied" />,
    );

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    expect(writeText).toHaveBeenCalledWith(code);
    expect(await screen.findByText("Copied")).toBeInTheDocument();
  });

  it("reports a refused clipboard write", async () => {
    const failure = new Error("denied");
    const user = userEvent.setup();
    vi.spyOn(navigator.clipboard, "writeText").mockRejectedValue(failure);
    const onCopyError = vi.fn();
    render(
      <CodeBlock code={code} copyLabel="Copy code" onCopyError={onCopyError} />,
    );

    await user.click(screen.getByRole("button", { name: "Copy code" }));

    await vi.waitFor(() => expect(onCopyError).toHaveBeenCalledWith(failure));
  });

  it("toggles wrapping and uses the highlight render prop", async () => {
    const user = userEvent.setup();
    const { container } = render(
      <CodeBlock
        code={code}
        wrapLabel="Wrap lines"
        highlight={(line, number) => <mark>{`${number}:${line}`}</mark>}
      />,
    );
    const pre = container.querySelector("pre");
    expect(pre).toHaveAttribute("data-wrap", "false");

    const toggle = screen.getByRole("button", { name: "Wrap lines" });
    await user.click(toggle);

    expect(toggle).toHaveAttribute("aria-pressed", "true");
    expect(pre).toHaveAttribute("data-wrap", "true");
    expect(screen.getByText("2:const b = 2;")).toBeInTheDocument();
  });
});
