import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/ui/button";
import {
  Collapsible,
  CollapsibleContent,
  CollapsibleTrigger,
} from "@/shared/ui/collapsible";

const meta = {
  title: "UI/Collapsible",
  component: Collapsible,
  render: (args) => (
    <Collapsible {...args} className="w-72 space-y-2">
      <div className="flex items-center justify-between gap-2">
        <span className="text-sm font-medium">3 repositories starred</span>
        <CollapsibleTrigger render={<Button variant="outline" size="sm" />}>
          Toggle details
        </CollapsibleTrigger>
      </div>
      <div className="rounded-lg border px-3 py-2 text-sm">aedst/server</div>
      <CollapsibleContent className="space-y-2">
        <div className="rounded-lg border px-3 py-2 text-sm">aedst/web</div>
        <div className="rounded-lg border px-3 py-2 text-sm">aedst/android</div>
      </CollapsibleContent>
    </Collapsible>
  ),
} satisfies Meta<typeof Collapsible>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Closed: Story = {};

export const Open: Story = { args: { defaultOpen: true } };

export const Disabled: Story = { args: { disabled: true } };
