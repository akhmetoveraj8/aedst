import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  DocumentKind,
  SearchService,
} from "@/shared/api/connect/generated/aedst/search/v1/search_pb";
import { rpc } from "@/test/mocks/transport";
import { withAppProviders } from "../../../../.storybook/with-app-providers";
import { SearchPage } from "./SearchPage";

const meta = {
  title: "Modules/Search/SearchPage",
  component: SearchPage,
  decorators: [withAppProviders],
} satisfies Meta<typeof SearchPage>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Prompt: Story = {};

export const Results: Story = {
  parameters: {
    searchParams: "?q=docs",
    rpc: [
      rpc(SearchService.method.search, () => ({
        hits: [
          {
            kind: DocumentKind.TASK,
            id: "t-1",
            title: "Write docs",
            snippet: "all the docs",
            link: "/tasks/t-1",
          },
        ],
        totalEstimate: 1,
      })),
    ],
  },
};

export const NoResults: Story = {
  parameters: {
    searchParams: "?q=nothing",
    rpc: [
      rpc(SearchService.method.search, () => ({ hits: [], totalEstimate: 0 })),
    ],
  },
};
