import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DatePicker } from "@/shared/ui/date-picker";

const formatDate = (date: Date) =>
  date.toLocaleDateString("en", {
    day: "numeric",
    month: "long",
    year: "numeric",
  });

const meta = {
  title: "UI/DatePicker",
  component: DatePicker,
  args: {
    placeholder: "Pick a date",
    formatDate,
  },
} satisfies Meta<typeof DatePicker>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Empty: Story = {};

export const Selected: Story = {
  args: { defaultValue: new Date(2026, 0, 15) },
};

export const Disabled: Story = {
  args: { defaultValue: new Date(2026, 0, 15), disabled: true },
};
