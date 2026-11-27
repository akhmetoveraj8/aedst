import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import * as React from "react";
import { describe, expect, it, vi } from "vitest";

import {
  AiFileTree,
  AiFileTreeFile,
  AiFileTreeFolder,
} from "@/shared/ui/ai-file-tree";

function Demo({
  onSelect,
  dir = "ltr",
}: {
  onSelect?: (path: string) => void;
  dir?: "ltr" | "rtl";
}) {
  return (
    <div dir={dir}>
      <AiFileTree
        aria-label="Changed files"
        defaultExpanded={new Set(["app"])}
        onSelect={onSelect}
      >
        <AiFileTreeFolder path="app" name="app">
          <AiFileTreeFile path="app/layout.tsx" name="layout.tsx" />
          <AiFileTreeFile path="app/page.tsx" name="page.tsx" />
        </AiFileTreeFolder>
        <AiFileTreeFolder path="lib" name="lib">
          <AiFileTreeFile path="lib/utils.ts" name="utils.ts" />
        </AiFileTreeFolder>
        <AiFileTreeFile path="package.json" name="package.json" />
      </AiFileTree>
    </div>
  );
}

const item = (name: string) => screen.getByRole("treeitem", { name });

describe("AiFileTree", () => {
  it("exposes tree semantics with level, set size and position", () => {
    render(<Demo />);
    expect(screen.getByRole("tree", { name: "Changed files" })).toBeVisible();
    expect(item("app")).toHaveAttribute("aria-level", "1");
    expect(item("app")).toHaveAttribute("aria-expanded", "true");
    expect(item("app")).toHaveAttribute("aria-setsize", "3");
    expect(item("app")).toHaveAttribute("aria-posinset", "1");
    expect(item("lib")).toHaveAttribute("aria-expanded", "false");
    expect(item("page.tsx")).toHaveAttribute("aria-level", "2");
    expect(item("page.tsx")).toHaveAttribute("aria-setsize", "2");
    expect(item("page.tsx")).toHaveAttribute("aria-posinset", "2");
    expect(item("package.json")).toHaveAttribute("aria-selected", "false");
    // Collapsed folders render no group.
    expect(screen.queryByRole("treeitem", { name: "utils.ts" })).toBeNull();
  });

  it("keeps exactly one item in the tab order (roving tabindex)", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    const stops = () =>
      screen
        .getAllByRole("treeitem")
        .filter((el) => el.getAttribute("tabindex") === "0");
    expect(stops()).toHaveLength(1);
    await user.tab();
    expect(item("app")).toHaveFocus();
    await user.keyboard("{ArrowDown}");
    expect(item("layout.tsx")).toHaveFocus();
    expect(stops()).toEqual([item("layout.tsx")]);
  });

  it("moves with Up, Down, Home and End", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.tab();
    await user.keyboard("{End}");
    expect(item("package.json")).toHaveFocus();
    await user.keyboard("{ArrowUp}");
    expect(item("lib")).toHaveFocus();
    await user.keyboard("{Home}");
    expect(item("app")).toHaveFocus();
  });

  it("opens, enters, leaves and closes folders with Right and Left (LTR)", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.tab();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(item("lib")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(item("lib")).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowRight}");
    expect(item("utils.ts")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(item("lib")).toHaveFocus();
    await user.keyboard("{ArrowLeft}");
    expect(item("lib")).toHaveAttribute("aria-expanded", "false");
  });

  it("mirrors Left and Right in RTL", async () => {
    const user = userEvent.setup();
    render(<Demo dir="rtl" />);
    await user.tab();
    await user.keyboard("{ArrowDown}{ArrowDown}{ArrowDown}");
    expect(item("lib")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(item("lib")).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{ArrowLeft}");
    expect(item("lib")).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowLeft}");
    expect(item("utils.ts")).toHaveFocus();
    await user.keyboard("{ArrowRight}");
    expect(item("lib")).toHaveFocus();
  });

  it("toggles folders and selects files with Enter and Space", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Demo onSelect={onSelect} />);
    await user.tab();
    await user.keyboard("{Enter}");
    expect(item("app")).toHaveAttribute("aria-expanded", "false");
    await user.keyboard("{Enter}");
    expect(item("app")).toHaveAttribute("aria-expanded", "true");
    await user.keyboard("{ArrowDown}{Enter}");
    expect(onSelect).toHaveBeenLastCalledWith("app/layout.tsx");
    await user.keyboard("{ArrowDown} ");
    expect(onSelect).toHaveBeenLastCalledWith("app/page.tsx");
  });

  it("reports the selected file with aria-selected", () => {
    function Selected() {
      const [path, setPath] = React.useState("app/page.tsx");
      return (
        <AiFileTree
          aria-label="Files"
          defaultExpanded={new Set(["app"])}
          selectedPath={path}
          onSelect={setPath}
        >
          <AiFileTreeFolder path="app" name="app">
            <AiFileTreeFile path="app/page.tsx" name="page.tsx" />
          </AiFileTreeFolder>
        </AiFileTree>
      );
    }
    render(<Selected />);
    expect(item("page.tsx")).toHaveAttribute("aria-selected", "true");
  });

  it("jumps to the next name that starts with the typed letters", async () => {
    const user = userEvent.setup();
    render(<Demo />);
    await user.tab();
    await user.keyboard("pa");
    expect(item("package.json")).toHaveFocus();
  });

  it("opens a folder and selects a file with the mouse", async () => {
    const user = userEvent.setup();
    const onSelect = vi.fn();
    render(<Demo onSelect={onSelect} />);
    await user.click(screen.getByText("lib"));
    expect(item("lib")).toHaveAttribute("aria-expanded", "true");
    await user.click(screen.getByText("package.json"));
    expect(onSelect).toHaveBeenCalledWith("package.json");
  });
});
