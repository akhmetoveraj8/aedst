import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { expect, fn, userEvent, within } from "storybook/test";

import { AiSuggestion, AiSuggestions } from "@/shared/ui/ai-suggestion";

const SUGGESTIONS = [
  "Add a dark mode toggle",
  "Fix the failing build",
  "Write tests for the form",
  "Add a loading state",
  "Find unused dependencies",
];

const meta = {
  title: "UI/AI/Suggestion",
  component: AiSuggestion,
  args: { suggestion: SUGGESTIONS[0], onClick: fn() },
  render: (args) => (
    <AiSuggestions aria-label="Suggestions" className="max-w-md">
      {SUGGESTIONS.map((suggestion) => (
        <AiSuggestion key={suggestion} {...args} suggestion={suggestion} />
      ))}
    </AiSuggestions>
  ),
} satisfies Meta<typeof AiSuggestion>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ args, canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: SUGGESTIONS[1] }));
    await expect(args.onClick).toHaveBeenCalledWith(SUGGESTIONS[1]);
  },
};
