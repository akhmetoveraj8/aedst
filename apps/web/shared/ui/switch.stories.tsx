import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Switch } from "@/shared/ui/switch";

const meta = {
  title: "UI/Switch",
  component: Switch,
  args: { "aria-label": "Airplane mode" },
} satisfies Meta<typeof Switch>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Checked: Story = { args: { defaultChecked: true } };

export const Small: Story = { args: { size: "sm", defaultChecked: true } };

export const Disabled: Story = { args: { disabled: true } };
