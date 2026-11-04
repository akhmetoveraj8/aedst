import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  TaskPriority,
  TaskStatus,
  TasksService,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { makeTask } from "@/test/fixtures";
import { Code, rpc, rpcError } from "@/test/mocks/transport";
import { withAppProviders } from "../../../../.storybook/with-app-providers";
import { TaskDetails } from "./TaskDetails";

const meta = {
  title: "Modules/Tasks/TaskDetails",
  component: TaskDetails,
  decorators: [withAppProviders],
  args: { taskId: "00000000-0000-4000-8000-000000000001" },
} satisfies Meta<typeof TaskDetails>;

export default meta;
type Story = StoryObj<typeof meta>;

export const InProgress: Story = {
  parameters: {
    rpc: [
      rpc(TasksService.method.getTask, () => ({
        task: makeTask({
          title: "Ship the release",
          description: "Tag, build and announce.",
          priority: TaskPriority.HIGH,
          status: TaskStatus.IN_PROGRESS,
        }),
      })),
    ],
  },
};

export const NotFound: Story = {
  parameters: {
    rpc: [rpcError(TasksService.method.getTask, Code.NotFound, "no such task")],
  },
};

export const LoadFailed: Story = {
  parameters: {
    rpc: [rpcError(TasksService.method.getTask, Code.Internal, "boom")],
  },
};
