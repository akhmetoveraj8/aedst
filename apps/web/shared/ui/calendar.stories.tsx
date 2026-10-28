import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Calendar } from "@/shared/ui/calendar";

const fixedMonth = new Date(2026, 0, 1);

const meta = {
  title: "UI/Calendar",
  component: Calendar,
  args: {
    defaultMonth: fixedMonth,
    // Default labels ("Sunday, December 28th") do not contain the visible day number (axe label-content-name-mismatch).
    labels: {
      labelDayButton: (date) =>
        `${date.getDate()} ${date.toLocaleString("en", { month: "long", year: "numeric" })}`,
    },
  },
} satisfies Meta<typeof Calendar>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  args: { mode: "single", selected: new Date(2026, 0, 15) },
};

export const Range: Story = {
  args: {
    mode: "range",
    selected: { from: new Date(2026, 0, 8), to: new Date(2026, 0, 14) },
  },
};

export const DropdownCaption: Story = {
  args: {
    mode: "single",
    captionLayout: "dropdown",
    startMonth: new Date(2020, 0),
    endMonth: new Date(2030, 11),
  },
};

export const TwoMonths: Story = {
  args: { mode: "single", numberOfMonths: 2 },
};
