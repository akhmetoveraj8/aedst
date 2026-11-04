import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  InputGroup,
  InputGroupAddon,
  InputGroupButton,
  InputGroupInput,
  InputGroupText,
  InputGroupTextarea,
} from "@/shared/ui/input-group";

const meta = {
  title: "UI/InputGroup",
  component: InputGroup,
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof InputGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const WithIcon: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupInput aria-label="Search" placeholder="Search..." />
      <InputGroupAddon>
        <HugeiconsIcon icon={Search01Icon} strokeWidth={2} />
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const TextAndButton: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupAddon>
        <InputGroupText>https://</InputGroupText>
      </InputGroupAddon>
      <InputGroupInput aria-label="Domain" placeholder="example.com" />
      <InputGroupAddon align="inline-end">
        <InputGroupButton variant="secondary">Go</InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};

export const WithTextarea: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupTextarea aria-label="Message" placeholder="Write a message" />
      <InputGroupAddon align="block-end">
        <InputGroupText>0 / 280</InputGroupText>
        <InputGroupButton variant="default" className="ms-auto">
          Send
        </InputGroupButton>
      </InputGroupAddon>
    </InputGroup>
  ),
};
