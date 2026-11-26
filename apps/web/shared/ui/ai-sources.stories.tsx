import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiSource,
  AiSources,
  AiSourcesContent,
  AiSourcesTrigger,
} from "@/shared/ui/ai-sources";

const sources = [
  {
    href: "https://docs.astro.build/en/install-and-setup/",
    title: "Install Astro | docs.astro.build",
  },
  {
    href: "https://www.npmjs.com/package/create-astro",
    title: "create-astro | npmjs.com",
  },
  // No title: the host name is the link text.
  { href: "https://pnpm.io/cli/create" },
];

const meta = {
  title: "UI/AI/Sources",
  component: AiSources,
  args: { defaultOpen: true, className: "max-w-sm" },
  render: (args) => (
    <AiSources {...args}>
      <AiSourcesTrigger>Used {sources.length} sources</AiSourcesTrigger>
      <AiSourcesContent>
        {sources.map((source) => (
          <AiSource
            key={source.href}
            {...source}
            newTabLabel="(opens in a new tab)"
          />
        ))}
      </AiSourcesContent>
    </AiSources>
  ),
} satisfies Meta<typeof AiSources>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Collapsed: Story = { args: { defaultOpen: false } };
