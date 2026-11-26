import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";

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
