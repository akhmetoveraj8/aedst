import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiTool,
  AiToolApproval,
  AiToolContent,
  AiToolHeader,
  AiToolInput,
  AiToolOutput,
} from "@/shared/ui/ai-tool";

const input = { command: "ls -la", cwd: "/workspace" };

const meta = {
  title: "UI/AI/Tool",
  component: AiTool,
  args: { defaultOpen: true, className: "max-w-md" },
  render: (args) => (
    <AiTool {...args}>
      <AiToolHeader state="output-available" title="Ran ls -la" />
      <AiToolContent>
        <AiToolInput label="Parameters" input={input} copyLabel="Copy" />
        <AiToolOutput
          label="Result"
          output={"total 8\ndrwxr-xr-x  app\n-rw-r--r--  package.json"}
        />
      </AiToolContent>
    </AiTool>
  ),
} satisfies Meta<typeof AiTool>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completed: Story = {};

export const Running: Story = {
  render: (args) => (
    <AiTool {...args}>
      <AiToolHeader
        state="input-available"
        statusLabel="Running"
        title="Running ls -la"
      />
      <AiToolContent>
        <AiToolInput label="Parameters" input={input} />
      </AiToolContent>
    </AiTool>
  ),
};

export const Failed: Story = {
  render: (args) => (
    <AiTool {...args}>
      <AiToolHeader
        state="output-error"
        statusLabel="Failed"
        title="Failed to run ls -la"
      />
      <AiToolContent>
        <AiToolInput label="Parameters" input={input} />
        <AiToolOutput
          label="Error"
          errorText="ls: /workspace: No such file or directory"
        />
      </AiToolContent>
    </AiTool>
  ),
};

export const ApprovalRequested: Story = {
  render: () => (
    <AiToolApproval
      className="max-w-md"
      title="Run rm -rf build?"
      description="The agent wants to delete the build directory."
      approveLabel="Approve"
      denyLabel="Deny"
      onApprove={() => undefined}
      onDeny={() => undefined}
    />
  ),
};
