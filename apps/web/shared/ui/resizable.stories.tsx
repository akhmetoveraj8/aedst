import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  ResizableHandle,
  ResizablePanel,
  ResizablePanelGroup,
} from "@/shared/ui/resizable";

const meta = {
  title: "UI/Resizable",
  component: ResizablePanelGroup,
  decorators: [
    (Story) => (
      <div className="h-64 w-full max-w-xl rounded-lg border">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof ResizablePanelGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Horizontal: Story = {
  render: (args) => (
    <ResizablePanelGroup {...args} orientation="horizontal">
      <ResizablePanel defaultSize="40%">
        <div className="flex h-full items-center justify-center p-4 text-sm">
          Sidebar
        </div>
      </ResizablePanel>
      <ResizableHandle withHandle aria-label="Resize sidebar" />
      <ResizablePanel defaultSize="60%">
        <div className="flex h-full items-center justify-center p-4 text-sm">
          Content
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};

export const Vertical: Story = {
  render: (args) => (
    <ResizablePanelGroup {...args} orientation="vertical">
      <ResizablePanel defaultSize="30%">
        <div className="flex h-full items-center justify-center p-4 text-sm">
          Header
        </div>
      </ResizablePanel>
      <ResizableHandle aria-label="Resize header" />
      <ResizablePanel defaultSize="70%">
        <div className="flex h-full items-center justify-center p-4 text-sm">
          Body
        </div>
      </ResizablePanel>
    </ResizablePanelGroup>
  ),
};
