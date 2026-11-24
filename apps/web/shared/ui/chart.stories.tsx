import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Chart } from "@/shared/ui/chart";

const months = ["Jan", "Feb", "Mar", "Apr"];

const meta = {
  title: "UI/Chart",
  component: Chart,
  args: { "aria-label": "Visitors per month", option: {} },
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Chart>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Bars: Story = {
  args: {
    option: {
      grid: { left: 32, right: 8, top: 16, bottom: 24 },
      xAxis: { type: "category", data: months },
      yAxis: { type: "value" },
      series: [
        { type: "bar", name: "Desktop", data: [186, 305, 237, 73] },
        { type: "bar", name: "Mobile", data: [80, 200, 120, 190] },
      ],
    },
  },
};

export const LineWithTooltipAndLegend: Story = {
  args: {
    "aria-label": "Visitors with legend",
    option: {
      grid: { left: 32, right: 8, top: 32, bottom: 24 },
      legend: { top: 0 },
      tooltip: { trigger: "axis" },
      xAxis: { type: "category", data: months },
      yAxis: { type: "value" },
      series: [
        { type: "line", name: "Desktop", data: [186, 305, 237, 73] },
        { type: "line", name: "Mobile", data: [80, 200, 120, 190] },
      ],
    },
  },
};
