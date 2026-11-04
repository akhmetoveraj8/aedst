import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
  FieldLegend,
  FieldSeparator,
  FieldSet,
} from "@/shared/ui/field";
import { Input } from "@/shared/ui/input";

const meta = {
  title: "UI/Field",
  component: Field,
  argTypes: {
    orientation: {
      control: "select",
      options: ["vertical", "horizontal", "responsive"],
    },
  },
  decorators: [
    (Story) => (
      <div className="w-80">
        <Story />
      </div>
    ),
  ],
} satisfies Meta<typeof Field>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <Field {...args}>
      <FieldLabel htmlFor="field-username">Username</FieldLabel>
      <Input id="field-username" placeholder="ada" />
      <FieldDescription>Your public display name.</FieldDescription>
    </Field>
  ),
};

export const Invalid: Story = {
  render: (args) => (
    <Field {...args} data-invalid>
      <FieldLabel htmlFor="field-email">Email</FieldLabel>
      <Input id="field-email" aria-invalid defaultValue="not-an-email" />
      <FieldError errors={[{ message: "Enter a valid email address." }]} />
    </Field>
  ),
};

export const Horizontal: Story = {
  args: { orientation: "horizontal" },
  render: (args) => (
    <Field {...args}>
      <FieldLabel htmlFor="field-city">City</FieldLabel>
      <Input id="field-city" defaultValue="Berlin" />
    </Field>
  ),
};

export const Fieldset: Story = {
  render: () => (
    <FieldSet>
      <FieldLegend>Profile</FieldLegend>
      <FieldGroup>
        <Field>
          <FieldLabel htmlFor="set-first">First name</FieldLabel>
          <Input id="set-first" />
        </Field>
        <FieldSeparator>or</FieldSeparator>
        <Field>
          <FieldLabel htmlFor="set-nick">Nickname</FieldLabel>
          <Input id="set-nick" />
        </Field>
      </FieldGroup>
    </FieldSet>
  ),
};
