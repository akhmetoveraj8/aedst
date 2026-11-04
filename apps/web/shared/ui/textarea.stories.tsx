import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Textarea } from "@/shared/ui/textarea";

const meta = {
  title: "UI/Textarea",
  component: Textarea,
  args: { "aria-label": "Message", placeholder: "Type your message here." },
} satisfies Meta<typeof Textarea>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = {
  args: { defaultValue: "Hello from the design system." },
};

export const Invalid: Story = { args: { "aria-invalid": true } };

export const Disabled: Story = { args: { disabled: true } };
