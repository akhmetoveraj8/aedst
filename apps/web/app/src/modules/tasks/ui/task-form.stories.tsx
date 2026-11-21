import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { TaskPriority } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { withAppProviders } from "../../../../.storybook/with-app-providers";
import { TaskForm } from "./TaskForm";

const meta = {
  title: "Modules/Tasks/TaskForm",
  component: TaskForm,
  decorators: [withAppProviders],
  args: {
    mode: "create",
    isSubmitting: false,
    onSubmit: () => undefined,
  },
} satisfies Meta<typeof TaskForm>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Create: Story = {};

export const Edit: Story = {
  args: {
    mode: "edit",
    defaultValues: {
      title: "Ship the release",
      description: "Tag, build and announce.",
      priority: TaskPriority.HIGH,
      dueDate: "2026-12-01",
    },
  },
};

export const Submitting: Story = { args: { isSubmitting: true } };

export const SubmitFailed: Story = { args: { submitErrorKind: "unavailable" } };
