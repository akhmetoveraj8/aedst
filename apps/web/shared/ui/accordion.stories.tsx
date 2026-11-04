import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Accordion,
  AccordionContent,
  AccordionItem,
  AccordionTrigger,
} from "@/shared/ui/accordion";

const meta = {
  title: "UI/Accordion",
  component: Accordion,
  decorators: [
    (Story) => (
      <div className="w-96">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Accordion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Accordion {...args} defaultValue={["shipping"]}>
      <AccordionItem value="shipping">
        <AccordionTrigger>Shipping</AccordionTrigger>
        <AccordionContent>
          Orders ship within two business days.
        </AccordionContent>
      </AccordionItem>
      <AccordionItem value="returns">
        <AccordionTrigger>Returns</AccordionTrigger>
        <AccordionContent>Returns are accepted for 30 days.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const Multiple: Story = {
  render: (args) => (
    <Accordion {...args} multiple defaultValue={["a", "b"]}>
      <AccordionItem value="a">
        <AccordionTrigger>First section</AccordionTrigger>
        <AccordionContent>First section content.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b">
        <AccordionTrigger>Second section</AccordionTrigger>
        <AccordionContent>Second section content.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};

export const DisabledItem: Story = {
  render: (args) => (
    <Accordion {...args}>
      <AccordionItem value="a">
        <AccordionTrigger>Available</AccordionTrigger>
        <AccordionContent>Available content.</AccordionContent>
      </AccordionItem>
      <AccordionItem value="b" disabled>
        <AccordionTrigger>Unavailable</AccordionTrigger>
        <AccordionContent>Unavailable content.</AccordionContent>
      </AccordionItem>
    </Accordion>
  ),
};
