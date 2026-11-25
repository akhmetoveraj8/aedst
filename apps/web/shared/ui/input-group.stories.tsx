import { Search01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, userEvent } from "storybook/test";

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

/** An invalid field inside a group still gets a distinct, solid ring on focus. */
export const InvalidFocusRing: Story = {
  render: (args) => (
    <InputGroup {...args}>
      <InputGroupInput
        aria-label="Email"
        aria-invalid
        defaultValue="not-an-email"
      />
    </InputGroup>
  ),
  play: async ({ canvas, canvasElement }) => {
    await userEvent.tab();
    await expect(canvas.getByRole("textbox")).toHaveFocus();
    const probe = document.createElement("span");
    probe.style.color = "var(--destructive)";
    document.body.append(probe);
    const destructive = getComputedStyle(probe).color;
    probe.remove();
    const group = canvasElement.querySelector<HTMLElement>(
      '[data-slot="input-group"]',
    );
    await expect(getComputedStyle(group as HTMLElement).boxShadow).toContain(
      destructive,
    );
  },
};
