import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Button } from "@/shared/ui/button";
import { Field, FieldLabel } from "@/shared/ui/field";
import { Form } from "@/shared/ui/form";
import { Input } from "@/shared/ui/input";

const meta = {
  title: "UI/Form",
  component: Form,
} satisfies Meta<typeof Form>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: () => (
    <Form noValidate className="flex max-w-sm flex-col gap-4">
      <Field>
        <FieldLabel htmlFor="form-name">Name</FieldLabel>
        <Input id="form-name" />
      </Field>
      <Button type="submit" className="w-fit">
        Save
      </Button>
    </Form>
  ),
};
