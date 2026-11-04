import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";

import { LocaleSelect } from "@/shared/ui/locale-select";

const options = [
  { value: "en", label: "English" },
  { value: "ru", label: "Русский" },
  { value: "tj", label: "Тоҷикӣ" },
  { value: "uz", label: "O'zbekcha" },
  { value: "ar", label: "العربية" },
];

const meta = {
  title: "UI/LocaleSelect",
  component: LocaleSelect,
  args: { value: "en", options, label: "Language", onValueChange: () => {} },
} satisfies Meta<typeof LocaleSelect>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  render: (args) => {
    const [value, setValue] = useState(args.value);
    return <LocaleSelect {...args} value={value} onValueChange={setValue} />;
  },
};
