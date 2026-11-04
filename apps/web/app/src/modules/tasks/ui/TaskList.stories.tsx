import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  TaskPriority,
  TaskStatus,
  TasksService,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import { makeTask } from "@/test/fixtures";
import { Code, rpc, rpcError } from "@/test/mocks/transport";
import { withAppProviders } from "../../../../.storybook/with-app-providers";
import { TaskList } from "./TaskList";

const meta = {
  title: "Modules/Tasks/TaskList",
  component: TaskList,
  decorators: [withAppProviders],
  parameters: { layout: "padded" },
} satisfies Meta<typeof TaskList>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Populated: Story = {
  parameters: {
    rpc: [
      rpc(TasksService.method.listTasks, () => ({
        tasks: [
          makeTask({
            title: "Write the quarterly report",
            priority: TaskPriority.URGENT,
            status: TaskStatus.IN_PROGRESS,
          }),
          makeTask({
            title: "Review pull requests",
            priority: TaskPriority.HIGH,
          }),
          makeTask({
            title: "Book the venue",
            priority: TaskPriority.LOW,
            status: TaskStatus.DONE,
          }),
        ],
      })),
    ],
  },
};

export const Empty: Story = {
  parameters: {
    rpc: [rpc(TasksService.method.listTasks, () => ({ tasks: [] }))],
  },
};

export const LoadFailed: Story = {
  parameters: {
    rpc: [rpcError(TasksService.method.listTasks, Code.Internal, "boom")],
  },
};
