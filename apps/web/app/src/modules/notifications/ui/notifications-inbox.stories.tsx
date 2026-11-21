import { timestampFromMs } from "@bufbuild/protobuf/wkt";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  NotificationKind,
  NotificationsService,
} from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { rpc } from "@/test/mocks/transport";
import { withAppProviders } from "../../../../.storybook/with-app-providers";
import { NotificationsInbox } from "./NotificationsInbox";

const meta = {
  title: "Modules/Notifications/NotificationsInbox",
  component: NotificationsInbox,
  decorators: [withAppProviders],
} satisfies Meta<typeof NotificationsInbox>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithNotifications: Story = {
  parameters: {
    rpc: [
      rpc(NotificationsService.method.listNotifications, () => ({
        notifications: [
          {
            id: "00000000-0000-4000-8000-000000000001",
            kind: NotificationKind.TASK_COMPLETED,
            title: "Task completed",
            body: "Write docs",
            link: "/tasks/1",
            createdAt: timestampFromMs(1_768_471_200_000),
          },
        ],
      })),
    ],
  },
};

export const Empty: Story = {
  parameters: {
    rpc: [
      rpc(NotificationsService.method.listNotifications, () => ({
        notifications: [],
      })),
    ],
  },
};
