import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { DirectionProvider, useDirection } from "@/shared/ui/direction";

function DirectionProbe() {
  const direction = useDirection();
  return (
    <p className="rounded-lg border p-3 text-sm">
      Resolved direction: <strong>{direction}</strong>
    </p>
  );
}

const meta = {
  title: "UI/DirectionProvider",
  component: DirectionProvider,
  render: (args) => (
    <DirectionProvider {...args}>
      <DirectionProbe />
    </DirectionProvider>
  ),
} satisfies Meta<typeof DirectionProvider>;

export default meta;
type Story = StoryObj<typeof meta>;

export const LeftToRight: Story = { args: { direction: "ltr" } };

export const RightToLeft: Story = { args: { direction: "rtl" } };
