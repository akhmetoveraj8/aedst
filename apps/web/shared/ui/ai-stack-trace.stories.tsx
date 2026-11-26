import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiStackTrace,
  AiStackTraceContent,
  AiStackTraceError,
  AiStackTraceFrames,
  AiStackTraceHeader,
  parseStackTrace,
} from "@/shared/ui/ai-stack-trace";

const STACK = `TypeError: Cannot read properties of undefined (reading 'total')
    at formatInvoice (app/lib/billing.ts:42:31)
    at InvoiceRow (app/components/invoice-row.tsx:18:12)
    at renderWithHooks (node_modules/react-dom/cjs/react-dom.development.js:14985:18)
    at beginWork (node_modules/react-dom/cjs/react-dom.development.js:19049:16)
    at process.processTicksAndRejections (node:internal/process/task_queues:105:5)`;

const { error, frames } = parseStackTrace(STACK);
const internalCount = frames.filter((frame) => frame.internal).length;

const meta = {
  title: "UI/AI/StackTrace",
  component: AiStackTrace,
  args: { className: "max-w-md" },
  render: (args) => (
    <AiStackTrace {...args}>
      <AiStackTraceHeader statusLabel="Failed">
        Failed: {error}
      </AiStackTraceHeader>
      <AiStackTraceContent>
        <AiStackTraceError>{error}</AiStackTraceError>
        <AiStackTraceFrames
          frames={frames}
          getFrameHref={(frame) => `#${frame.file}:${frame.line}`}
          internalFramesLabel={`${internalCount} framework frames`}
          copyLabel="Copy frames"
          copiedLabel="Copied"
        />
      </AiStackTraceContent>
    </AiStackTrace>
  ),
} satisfies Meta<typeof AiStackTrace>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Collapsed: Story = { args: { defaultOpen: false } };

/** Frames without links (no editor to open). */
export const PlainFrames: Story = {
  render: (args) => (
    <AiStackTrace {...args}>
      <AiStackTraceHeader>Failed: {error}</AiStackTraceHeader>
      <AiStackTraceContent>
        <AiStackTraceFrames
          frames={frames}
          internalFramesLabel={`${internalCount} framework frames`}
        />
      </AiStackTraceContent>
    </AiStackTrace>
  ),
};
