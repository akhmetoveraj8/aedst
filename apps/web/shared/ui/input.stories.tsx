import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Input } from "@/shared/ui/input";

const meta = {
  title: "UI/Input",
  component: Input,
  args: {
    "aria-label": "Email",
    placeholder: "name@example.com",
    type: "email",
  },
  argTypes: {
    type: {
      control: "select",
      options: ["text", "email", "password", "number", "file"],
    },
  },
  decorators: [
    (Story) => (
      <div className="w-72">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Input>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = { args: { defaultValue: "ada@example.com" } };

export const Disabled: Story = { args: { disabled: true } };

export const Invalid: Story = {
  args: { "aria-invalid": true, defaultValue: "not-an-email" },
};

export const File: Story = {
  args: { type: "file", "aria-label": "Upload file", placeholder: undefined },
};
