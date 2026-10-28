import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { AspectRatio } from "@/shared/ui/aspect-ratio";

const meta = {
  title: "UI/AspectRatio",
  component: AspectRatio,
  args: { ratio: 16 / 9 },
  argTypes: { ratio: { control: "number" } },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof AspectRatio>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Widescreen: Story = {
  render: (args) => (
    <AspectRatio
      {...args}
      className="flex items-center justify-center rounded-lg bg-muted text-sm text-foreground"
    >
      16:9
    </AspectRatio>
  ),
};

export const Square: Story = {
  args: { ratio: 1 },
  render: (args) => (
    <AspectRatio
      {...args}
      className="flex items-center justify-center rounded-lg bg-muted text-sm text-foreground"
    >
      1:1
    </AspectRatio>
  ),
};
