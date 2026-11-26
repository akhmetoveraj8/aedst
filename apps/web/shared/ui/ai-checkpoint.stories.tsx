import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiCheckpoint,
  AiCheckpointIcon,
  AiCheckpointTrigger,
} from "@/shared/ui/ai-checkpoint";

const meta = {
  title: "UI/AI/Checkpoint",
  component: AiCheckpoint,
  args: { className: "max-w-md" },
  render: (args) => (
    <div className="flex max-w-md flex-col gap-4 text-sm">
      <p>Renamed Button to Action in components/ui/button.tsx.</p>
      <AiCheckpoint {...args}>
        <AiCheckpointIcon />
        Button renamed
        <AiCheckpointTrigger aria-label="Restore to Button renamed">
          Restore
        </AiCheckpointTrigger>
      </AiCheckpoint>
      <p>Updated the Button page to say Action.</p>
    </div>
  ),
} satisfies Meta<typeof AiCheckpoint>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithTooltip: Story = {
  render: (args) => (
    <AiCheckpoint {...args}>
      Docs updated
      <AiCheckpointTrigger
        aria-label="Restore to Docs updated"
        tooltip="Later messages are removed"
      >
        Restore
      </AiCheckpointTrigger>
    </AiCheckpoint>
  ),
};

/** The latest turn: nothing to restore, so no button. */
export const Latest: Story = {
  render: (args) => (
    <AiCheckpoint {...args}>
      <AiCheckpointIcon />
      Tests added
    </AiCheckpoint>
  ),
};
