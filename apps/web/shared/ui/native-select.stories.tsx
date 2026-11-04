import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  NativeSelect,
  NativeSelectOptGroup,
  NativeSelectOption,
} from "@/shared/ui/native-select";

const meta = {
  title: "UI/NativeSelect",
  component: NativeSelect,
  args: { "aria-label": "Fruit" },
  argTypes: { size: { control: "select", options: ["default", "sm"] } },
} satisfies Meta<typeof NativeSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <NativeSelect {...args}>
      <NativeSelectOption value="apple">Apple</NativeSelectOption>
      <NativeSelectOption value="banana">Banana</NativeSelectOption>
      <NativeSelectOption value="cherry">Cherry</NativeSelectOption>
    </NativeSelect>
  ),
};

export const Grouped: Story = {
  render: (args) => (
    <NativeSelect {...args} size="sm" aria-label="Produce">
      <NativeSelectOptGroup label="Fruit">
        <NativeSelectOption value="apple">Apple</NativeSelectOption>
        <NativeSelectOption value="pear">Pear</NativeSelectOption>
      </NativeSelectOptGroup>
      <NativeSelectOptGroup label="Vegetables">
        <NativeSelectOption value="carrot">Carrot</NativeSelectOption>
      </NativeSelectOptGroup>
    </NativeSelect>
  ),
};

export const Disabled: Story = {
  render: (args) => (
    <NativeSelect {...args} disabled>
      <NativeSelectOption value="apple">Apple</NativeSelectOption>
    </NativeSelect>
  ),
};

export const Invalid: Story = {
  render: (args) => (
    <NativeSelect {...args} aria-invalid="true">
      <NativeSelectOption value="">Choose a fruit</NativeSelectOption>
      <NativeSelectOption value="apple">Apple</NativeSelectOption>
    </NativeSelect>
  ),
};
