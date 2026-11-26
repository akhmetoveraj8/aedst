import { Search01Icon } from "@hugeicons/core-free-icons";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiSubagent,
  AiSubagentContent,
  AiSubagentMeta,
  AiSubagentModel,
  AiSubagentStep,
  AiSubagentSteps,
  AiSubagentTask,
  AiSubagentTools,
  AiSubagentTrigger,
} from "@/shared/ui/ai-subagent";

const meta = {
  title: "UI/AI/Subagent",
  component: AiSubagent,
  args: { defaultOpen: true, className: "max-w-md" },
  render: (args) => (
    <AiSubagent {...args}>
      <AiSubagentTrigger title="Ran the research agent" description="12 s" />
      <AiSubagentContent>
        <AiSubagentTask>
          Find how Next.js builds the image cache key.
        </AiSubagentTask>
        <AiSubagentMeta>
          <AiSubagentModel label="Model" model="claude-sonnet" />
          <AiSubagentTools label="Tools" tools={["webSearch", "readFile"]} />
        </AiSubagentMeta>
        <AiSubagentSteps>
          <AiSubagentStep icon={Search01Icon} label="Searched the web" />
          <AiSubagentStep label="Read image-optimizer.ts" />
        </AiSubagentSteps>
      </AiSubagentContent>
    </AiSubagent>
  ),
} satisfies Meta<typeof AiSubagent>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completed: Story = {};

export const Running: Story = {
  render: (args) => (
    <AiSubagent {...args}>
      <AiSubagentTrigger
        status="running"
        statusLabel="Running"
        title="Running the research agent"
      />
      <AiSubagentContent>
        <AiSubagentTask>
          Find how Next.js builds the image cache key.
        </AiSubagentTask>
        <AiSubagentSteps>
          <AiSubagentStep
            status="running"
            statusLabel="Running"
            icon={Search01Icon}
            label="Searching the web"
          />
        </AiSubagentSteps>
      </AiSubagentContent>
    </AiSubagent>
  ),
};
