import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Trace, type TraceStep } from "@/shared/ui/trace";

const statusLabels = {
  pending: "Pending",
  running: "Running",
  success: "Done",
  error: "Failed",
  skipped: "Skipped",
};

const steps: TraceStep[] = [
  {
    id: "plan",
    title: "Plan the change",
    status: "success",
    duration: "0.8 s",
    detail: "Three files to edit, one test to add.",
  },
  {
    id: "edit",
    title: "Edit files",
    status: "running",
    children: [
      {
        id: "edit-1",
        title: "Read task-form.tsx",
        status: "success",
        duration: "0.1 s",
      },
      {
        id: "edit-2",
        title: "Write task-form.tsx",
        status: "running",
        detail: "Applying 2 hunks",
      },
      { id: "edit-3", title: "Format", status: "pending" },
    ],
  },
  {
    id: "test",
    title: "Run tests",
    status: "error",
    duration: "12.4 s",
    detail: "1 of 48 tests failed: task-form.test.tsx",
  },
  { id: "deploy", title: "Deploy preview", status: "skipped" },
];

const meta = {
  title: "UI/Trace",
  component: Trace,
  args: { steps, statusLabels, className: "max-w-md" },
} satisfies Meta<typeof Trace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Flat: Story = {
  args: {
    steps: [
      { id: "a", title: "Fetch", status: "success", duration: "0.2 s" },
      { id: "b", title: "Parse", status: "running" },
      { id: "c", title: "Store", status: "pending" },
    ],
  },
};
