import { Search01Icon } from "@hugeicons/core-free-icons";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiChainOfThought,
  AiChainOfThoughtContent,
  AiChainOfThoughtHeader,
  AiChainOfThoughtSearchResult,
  AiChainOfThoughtSearchResults,
  AiChainOfThoughtStep,
  AiChainOfThoughtSteps,
} from "@/shared/ui/ai-chain-of-thought";

const meta = {
  title: "UI/AI/ChainOfThought",
  component: AiChainOfThought,
  args: { defaultOpen: true, className: "max-w-md" },
  render: (args) => (
    <AiChainOfThought {...args}>
      <AiChainOfThoughtHeader description="3 steps">
        Researched the cache key
      </AiChainOfThoughtHeader>
      <AiChainOfThoughtContent>
        <AiChainOfThoughtSteps>
          <AiChainOfThoughtStep
            label="Read the build log for dpl_8Kx2"
            statusLabel="Done"
          />
          <AiChainOfThoughtStep
            icon={Search01Icon}
            label="Searched the web for next.js image cache key"
            description="2 results"
          >
            <AiChainOfThoughtSearchResults>
              <AiChainOfThoughtSearchResult>
                nextjs.org
              </AiChainOfThoughtSearchResult>
              <AiChainOfThoughtSearchResult>
                github.com
              </AiChainOfThoughtSearchResult>
            </AiChainOfThoughtSearchResults>
          </AiChainOfThoughtStep>
          <AiChainOfThoughtStep
            status="running"
            statusLabel="Running"
            label="Searching the code for cacheKey"
          />
          <AiChainOfThoughtStep
            status="pending"
            statusLabel="Pending"
            label="Write the fix"
          />
        </AiChainOfThoughtSteps>
      </AiChainOfThoughtContent>
    </AiChainOfThought>
  ),
} satisfies Meta<typeof AiChainOfThought>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Open: Story = {};

export const Closed: Story = { args: { defaultOpen: false } };
