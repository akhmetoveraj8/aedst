import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Label } from "@/shared/ui/label";
import { RadioGroup, RadioGroupItem } from "@/shared/ui/radio-group";

const meta = {
  title: "UI/RadioGroup",
  component: RadioGroup,
  args: { defaultValue: "comfortable", "aria-label": "Density" },
} satisfies Meta<typeof RadioGroup>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => (
    <RadioGroup {...args}>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="compact" id="rg-compact" />
        <Label htmlFor="rg-compact">Compact</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="comfortable" id="rg-comfortable" />
        <Label htmlFor="rg-comfortable">Comfortable</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="spacious" id="rg-spacious" />
        <Label htmlFor="rg-spacious">Spacious</Label>
      </div>
    </RadioGroup>
  ),
};

export const WithDisabledItem: Story = {
  render: (args) => (
    <RadioGroup {...args} defaultValue="a">
      <div className="flex items-center gap-2">
        <RadioGroupItem value="a" id="rgd-a" />
        <Label htmlFor="rgd-a">Available</Label>
      </div>
      <div className="flex items-center gap-2">
        <RadioGroupItem value="b" id="rgd-b" disabled />
        <Label htmlFor="rgd-b">Sold out</Label>
      </div>
    </RadioGroup>
  ),
};
