import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  AiFileTree,
  AiFileTreeFile,
  AiFileTreeFolder,
} from "@/shared/ui/ai-file-tree";
import { Badge } from "@/shared/ui/badge";

const meta = {
  title: "UI/AI/FileTree",
  component: AiFileTree,
  args: {
    "aria-label": "Changed files",
    className: "max-w-xs",
    defaultExpanded: new Set(["app", "components", "components/ui"]),
  },
  render: function Render(args) {
    const [selected, setSelected] = React.useState("components/ui/button.tsx");
    return (
      <AiFileTree {...args} selectedPath={selected} onSelect={setSelected}>
        <AiFileTreeFolder path="app" name="app">
          <AiFileTreeFile path="app/layout.tsx" name="layout.tsx" />
          <AiFileTreeFile path="app/page.tsx" name="page.tsx" />
        </AiFileTreeFolder>
        <AiFileTreeFolder path="components" name="components">
          <AiFileTreeFolder path="components/ui" name="ui">
            <AiFileTreeFile
              path="components/ui/button.tsx"
              name="button.tsx"
              actions={<Badge variant="secondary">+12 -3</Badge>}
            />
          </AiFileTreeFolder>
          <AiFileTreeFile
            path="components/login-form.tsx"
            name="login-form.tsx"
          />
        </AiFileTreeFolder>
        <AiFileTreeFile path="package.json" name="package.json" />
      </AiFileTree>
    );
  },
} satisfies Meta<typeof AiFileTree>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Collapsed: Story = {
  args: { defaultExpanded: new Set<string>() },
};

/** The selected file is the tab stop; Home, Down and Left move and fold. */
export const Keyboard: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    // The backward arrow is Left in LTR and Right in RTL.
    const back =
      getComputedStyle(canvasElement).direction === "rtl"
        ? "{ArrowRight}"
        : "{ArrowLeft}";
    await userEvent.tab();
    await expect(
      canvas.getByRole("treeitem", { name: "button.tsx" }),
    ).toHaveFocus();
    await userEvent.keyboard("{Home}");
    await expect(canvas.getByRole("treeitem", { name: "app" })).toHaveFocus();
    await userEvent.keyboard("{ArrowDown}");
    await expect(
      canvas.getByRole("treeitem", { name: "layout.tsx" }),
    ).toHaveFocus();
    await userEvent.keyboard(`${back}${back}`);
    await expect(canvas.getByRole("treeitem", { name: "app" })).toHaveAttribute(
      "aria-expanded",
      "false",
    );
  },
};
