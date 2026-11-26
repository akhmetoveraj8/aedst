import {
  CheckmarkCircle02Icon,
  Delete02Icon,
} from "@hugeicons/core-free-icons";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiQueue,
  AiQueueItem,
  AiQueueItemAction,
  AiQueueItemActions,
  AiQueueList,
  AiQueueSection,
  AiQueueSectionContent,
  AiQueueSectionTrigger,
} from "@/shared/ui/ai-queue";

const meta = {
  title: "UI/AI/Queue",
  component: AiQueue,
  args: { className: "max-w-md" },
  render: (args) => (
    <AiQueue {...args}>
      <AiQueueSection>
        <AiQueueSectionTrigger label="3 to do" />
        <AiQueueSectionContent>
          <AiQueueList>
            <AiQueueItem
              status="in-progress"
              statusLabel="In progress"
              label="Fix the select trigger focus ring"
              description="The field clips the ring on the inline-end side."
            />
            <AiQueueItem label="Update the registry snapshots">
              <AiQueueItemActions>
                <AiQueueItemAction label="Remove" icon={Delete02Icon} />
              </AiQueueItemActions>
            </AiQueueItem>
            <AiQueueItem label="Add combobox tests" />
          </AiQueueList>
        </AiQueueSectionContent>
      </AiQueueSection>
      <AiQueueSection defaultOpen={false}>
        <AiQueueSectionTrigger
          icon={CheckmarkCircle02Icon}
          label="2 completed"
        />
        <AiQueueSectionContent>
          <AiQueueList>
            <AiQueueItem status="completed" label="Write the migration guide" />
            <AiQueueItem status="completed" label="Add a changeset" />
          </AiQueueList>
        </AiQueueSectionContent>
      </AiQueueSection>
    </AiQueue>
  ),
} satisfies Meta<typeof AiQueue>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};
