import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { ToggleGroup, ToggleGroupItem } from "@/shared/ui/toggle-group";

const meta = {
  title: "UI/ToggleGroup",
  component: ToggleGroup,
  args: { "aria-label": "Text formatting" },
} satisfies Meta<typeof ToggleGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <ToggleGroup {...args} defaultValue={["bold"]} multiple>
      <ToggleGroupItem value="bold">Bold</ToggleGroupItem>
      <ToggleGroupItem value="italic">Italic</ToggleGroupItem>
      <ToggleGroupItem value="underline">Underline</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const OutlineJoined: Story = {
  render: (args) => (
    <ToggleGroup
      {...args}
      variant="outline"
      spacing={0}
      defaultValue={["left"]}
    >
      <ToggleGroupItem value="left">Left</ToggleGroupItem>
      <ToggleGroupItem value="center">Center</ToggleGroupItem>
      <ToggleGroupItem value="right">Right</ToggleGroupItem>
    </ToggleGroup>
  ),
};

export const Vertical: Story = {
  render: (args) => (
    <ToggleGroup {...args} orientation="vertical" variant="outline">
      <ToggleGroupItem value="a">First</ToggleGroupItem>
      <ToggleGroupItem value="b">Second</ToggleGroupItem>
    </ToggleGroup>
  ),
};
