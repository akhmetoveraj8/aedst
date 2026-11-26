import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import * as React from "react";

import {
  AiTerminal,
  AiTerminalActions,
  AiTerminalClearButton,
  AiTerminalContent,
  AiTerminalHeader,
  AiTerminalTitle,
} from "@/shared/ui/ai-terminal";

const BUILD = `> acme-chat@0.1.0 build
> next build

   Creating an optimized production build ...
 Compiled successfully in 4.2s
 Generating static pages (12/12)`;

const LINT = `> acme-chat@0.1.0 lint
> biome check .

app/api/chat/route.ts:14:7 lint/correctness/noUnusedVariables
  This variable is unused.

Checked 42 files. Found 1 error.
 ELIFECYCLE  Command failed with exit code 1.`;

const meta = {
  title: "UI/AI/Terminal",
  component: AiTerminal,
  args: { output: BUILD, defaultOpen: true, className: "max-w-md" },
  render: (args) => (
    <AiTerminal {...args}>
      <AiTerminalHeader>
        <AiTerminalTitle>Ran pnpm build</AiTerminalTitle>
      </AiTerminalHeader>
      <AiTerminalContent copyLabel="Copy output" copiedLabel="Copied" />
    </AiTerminal>
  ),
} satisfies Meta<typeof AiTerminal>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Completed: Story = {};

export const ExitCode: Story = {
  args: { output: LINT },
  render: (args) => (
    <AiTerminal {...args}>
      <AiTerminalHeader>
        <AiTerminalTitle status="error" statusLabel="Failed">
          pnpm lint exited with code 1
        </AiTerminalTitle>
      </AiTerminalHeader>
      <AiTerminalContent copyLabel="Copy output" copiedLabel="Copied" />
    </AiTerminal>
  ),
};

/** Output streams in line by line; the line opens once output arrives. */
export const Streaming: Story = {
  args: { output: "", defaultOpen: undefined },
  render: function Render(args) {
    const lines = BUILD.split("\n");
    const [count, setCount] = React.useState(1);
    React.useEffect(() => {
      if (count >= lines.length) {
        return;
      }
      const timer = setTimeout(() => setCount((value) => value + 1), 400);
      return () => clearTimeout(timer);
    }, [count, lines.length]);
    const streaming = count < lines.length;
    return (
      <AiTerminal
        {...args}
        output={lines.slice(0, count).join("\n")}
        isStreaming={streaming}
        onClear={() => setCount(0)}
      >
        <AiTerminalHeader>
          <AiTerminalTitle statusLabel={streaming ? "Running" : undefined}>
            {streaming ? "Running pnpm build" : "Ran pnpm build"}
          </AiTerminalTitle>
          <AiTerminalActions>
            <AiTerminalClearButton label="Clear output" />
          </AiTerminalActions>
        </AiTerminalHeader>
        <AiTerminalContent />
      </AiTerminal>
    );
  },
};
