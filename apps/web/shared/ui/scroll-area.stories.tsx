import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ScrollArea, ScrollBar } from "@/shared/ui/scroll-area";

const meta = {
  title: "UI/ScrollArea",
  component: ScrollArea,
} satisfies Meta<typeof ScrollArea>;

export default meta;
type Story = StoryObj<typeof meta>;

const items = Array.from({ length: 30 }, (_, index) => `Item ${index + 1}`);

export const Default: Story = {
  render: () => (
    <ScrollArea className="h-48 w-56 rounded-md border">
      <ul className="p-3 text-sm">
        {items.map((item) => (
          <li key={item} className="py-1">
            {item}
          </li>
        ))}
      </ul>
    </ScrollArea>
  ),
};

export const Horizontal: Story = {
  render: () => (
    <ScrollArea className="w-64 rounded-md border whitespace-nowrap">
      <div className="flex gap-3 p-3 pb-5">
        {items.slice(0, 12).map((item) => (
          <div
            key={item}
            className="grid h-16 w-24 shrink-0 place-items-center rounded-md bg-muted text-sm"
          >
            {item}
          </div>
        ))}
      </div>
      <ScrollBar orientation="horizontal" />
    </ScrollArea>
  ),
};
