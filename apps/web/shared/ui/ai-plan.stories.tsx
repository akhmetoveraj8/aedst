import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiPlan,
  AiPlanAction,
  AiPlanContent,
  AiPlanDescription,
  AiPlanFooter,
  AiPlanHeader,
  AiPlanStep,
  AiPlanSteps,
  AiPlanTrigger,
} from "@/shared/ui/ai-plan";
import { Button } from "@/shared/ui/button";

const meta = {
  title: "UI/AI/Plan",
  component: AiPlan,
  args: { className: "max-w-md" },
  render: (args) => (
    <AiPlan {...args}>
      <AiPlanHeader>
        <AiPlanTrigger description="2 of 4 done">
          Plan: migrate to Base UI
        </AiPlanTrigger>
        <AiPlanAction>
          <Button variant="ghost" size="sm">
            Edit
          </Button>
        </AiPlanAction>
      </AiPlanHeader>
      <AiPlanContent>
        <AiPlanDescription>
          Swap the Radix primitives for Base UI, one component at a time.
        </AiPlanDescription>
        <AiPlanSteps>
          <AiPlanStep label="Replace the Radix imports" statusLabel="Done" />
          <AiPlanStep label="Update the stories" statusLabel="Done" />
          <AiPlanStep
            status="running"
            statusLabel="In progress"
            label="Rename asChild to render"
          />
          <AiPlanStep
            status="pending"
            statusLabel="Pending"
            label="Run the type checker"
          />
        </AiPlanSteps>
        <AiPlanFooter>
          <Button size="sm">Build it</Button>
        </AiPlanFooter>
      </AiPlanContent>
    </AiPlan>
  ),
} satisfies Meta<typeof AiPlan>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Streaming: Story = { args: { isStreaming: true } };

export const Collapsed: Story = { args: { defaultOpen: false } };
