import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/ui/button";
import {
  ButtonGroup,
  ButtonGroupSeparator,
  ButtonGroupText,
} from "@/shared/ui/button-group";

const meta = {
  title: "UI/ButtonGroup",
  component: ButtonGroup,
  argTypes: {
    orientation: { control: "select", options: ["horizontal", "vertical"] },
  },
} satisfies Meta<typeof ButtonGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <ButtonGroup {...args} aria-label="Text alignment">
      <Button variant="outline">Left</Button>
      <Button variant="outline">Center</Button>
      <Button variant="outline">Right</Button>
    </ButtonGroup>
  ),
};

export const Vertical: Story = {
  args: { orientation: "vertical" },
  render: (args) => (
    <ButtonGroup {...args} aria-label="Zoom">
      <Button variant="outline">Zoom in</Button>
      <Button variant="outline">Zoom out</Button>
    </ButtonGroup>
  ),
};

export const WithTextAndSeparator: Story = {
  render: (args) => (
    <ButtonGroup {...args} aria-label="Pagination">
      <ButtonGroupText>Page 1</ButtonGroupText>
      <ButtonGroupSeparator />
      <Button variant="outline">Next</Button>
    </ButtonGroup>
  ),
};
