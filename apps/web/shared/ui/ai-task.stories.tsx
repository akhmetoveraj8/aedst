import { Search01Icon } from "@hugeicons/core-free-icons";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiTask,
  AiTaskContent,
  AiTaskItem,
  AiTaskItemFile,
  AiTaskTrigger,
} from "@/shared/ui/ai-task";

const meta = {
  title: "UI/AI/Task",
  component: AiTask,
  args: { className: "max-w-md" },
  render: (args) => (
    <AiTask {...args}>
      <AiTaskTrigger
        icon={Search01Icon}
        title="Found the project files"
        description="4 steps"
      />
      <AiTaskContent>
        <AiTaskItem
          icon={Search01Icon}
          label='Searched for "metadata"'
          statusLabel="Done"
        />
        <AiTaskItem
          label={
            <>
              Read <AiTaskItemFile>app/layout.tsx</AiTaskItemFile>
            </>
          }
        />
        <AiTaskItem
          label={
            <>
              Read <AiTaskItemFile>app/page.tsx</AiTaskItemFile>
            </>
          }
        />
        <AiTaskItem
          status="running"
          statusLabel="Running"
          label={
            <>
              Editing <AiTaskItemFile>app/page.tsx</AiTaskItemFile>
            </>
          }
        />
      </AiTaskContent>
    </AiTask>
  ),
} satisfies Meta<typeof AiTask>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Failed: Story = {
  render: (args) => (
    <AiTask {...args}>
      <AiTaskTrigger
        status="error"
        statusLabel="Failed"
        title="Failed to edit app/page.tsx"
      />
      <AiTaskContent>
        <AiTaskItem
          status="error"
          statusLabel="Failed"
          label="Write app/page.tsx: permission denied"
        />
      </AiTaskContent>
    </AiTask>
  ),
};
