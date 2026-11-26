import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  AiInlineCitation,
  AiInlineCitationCard,
  AiInlineCitationCardBody,
  AiInlineCitationCardTrigger,
  AiInlineCitationQuote,
  AiInlineCitationSource,
  AiInlineCitationText,
} from "@/shared/ui/ai-inline-citation";

const suspense = {
  url: "https://react.dev/reference/react/Suspense",
  title: "<Suspense>",
  description: "Display a fallback until its children have finished loading.",
};
const streaming = {
  url: "https://nextjs.org/docs/app/getting-started/linking-and-navigating",
  title: "Linking and Navigating",
  description: "How the App Router streams a route to the browser.",
};

const meta = {
  title: "UI/AI/InlineCitation",
  component: AiInlineCitation,
  render: (args) => (
    <p className="max-w-sm text-sm leading-relaxed">
      <AiInlineCitation {...args}>
        <AiInlineCitationText>
          Wrap a slow part of the page in a Suspense boundary and React sends
          the fallback first.
        </AiInlineCitationText>{" "}
        <AiInlineCitationCard>
          <AiInlineCitationCardTrigger sources={[suspense.url]} />
          <AiInlineCitationCardBody>
            <AiInlineCitationSource
              {...suspense}
              newTabLabel="(opens in a new tab)"
            />
          </AiInlineCitationCardBody>
        </AiInlineCitationCard>
      </AiInlineCitation>
    </p>
  ),
} satisfies Meta<typeof AiInlineCitation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

/** Several sources behind one trigger, with a quote. */
export const MultipleSources: Story = {
  render: (args) => (
    <p className="max-w-sm text-sm leading-relaxed">
      <AiInlineCitation {...args}>
        <AiInlineCitationText>
          Next.js streams a route in chunks, so the page shows up before every
          request finishes.
        </AiInlineCitationText>{" "}
        <AiInlineCitationCard defaultOpen>
          <AiInlineCitationCardTrigger
            sources={[streaming.url, suspense.url]}
            moreLabel="and 1 more source"
          />
          <AiInlineCitationCardBody>
            <AiInlineCitationSource
              {...streaming}
              newTabLabel="(opens in a new tab)"
            >
              <AiInlineCitationQuote>
                The App Router streams each route segment as it is ready.
              </AiInlineCitationQuote>
            </AiInlineCitationSource>
            <AiInlineCitationSource
              {...suspense}
              newTabLabel="(opens in a new tab)"
            />
          </AiInlineCitationCardBody>
        </AiInlineCitationCard>
      </AiInlineCitation>
    </p>
  ),
};
