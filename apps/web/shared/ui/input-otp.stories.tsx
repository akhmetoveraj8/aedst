import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import {
  InputOTP,
  InputOTPGroup,
  InputOTPSeparator,
  InputOTPSlot,
} from "@/shared/ui/input-otp";

const slots = (
  <>
    <InputOTPGroup>
      <InputOTPSlot index={0} />
      <InputOTPSlot index={1} />
      <InputOTPSlot index={2} />
    </InputOTPGroup>
    <InputOTPSeparator />
    <InputOTPGroup>
      <InputOTPSlot index={3} />
      <InputOTPSlot index={4} />
      <InputOTPSlot index={5} />
    </InputOTPGroup>
  </>
);

const meta = {
  title: "UI/InputOTP",
  component: InputOTP,
  args: { maxLength: 6, "aria-label": "One-time code", children: slots },
} satisfies Meta<typeof InputOTP>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const WithValue: Story = { args: { defaultValue: "123456" } };

export const Disabled: Story = { args: { disabled: true, defaultValue: "12" } };

export const Invalid: Story = {
  args: {
    "aria-invalid": true,
    defaultValue: "123",
    maxLength: 4,
    children: (
      <InputOTPGroup>
        <InputOTPSlot index={0} aria-invalid />
        <InputOTPSlot index={1} aria-invalid />
        <InputOTPSlot index={2} aria-invalid />
        <InputOTPSlot index={3} aria-invalid />
      </InputOTPGroup>
    ),
  },
};
