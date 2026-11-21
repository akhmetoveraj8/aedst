import type { Meta, StoryObj } from "@storybook/nextjs-vite";

import { Typography } from "@/shared/ui/typography";

const meta = {
  title: "UI/Typography",
  component: Typography,
  args: { children: "The quick brown fox jumps over the lazy dog." },
  argTypes: {
    variant: {
      control: "select",
      options: [
        "h1",
        "h2",
        "h3",
        "h4",
        "p",
        "blockquote",
        "list",
        "inline-code",
        "lead",
        "large",
        "small",
        "muted",
      ],
    },
  },
} satisfies Meta<typeof Typography>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {};

export const Scale: Story = {
  render: () => (
    <article className="max-w-prose">
      <Typography variant="h1">Taxing laughter</Typography>
      <Typography variant="lead">
        A modal dialog that interrupts the user with important content.
      </Typography>
      <Typography variant="h2">The plan</Typography>
      <Typography>
        The king thought long and hard, and finally came up with a plan.
      </Typography>
      <Typography variant="blockquote">
        After all, everyone enjoys a good joke.
      </Typography>
      <Typography variant="h3">The rules</Typography>
      <Typography variant="list">
        <li>First level of puns: 5 gold coins</li>
        <li>Second level of jokes: 10 gold coins</li>
      </Typography>
      <Typography variant="h4">Notes</Typography>
      <Typography>
        Install with <Typography variant="inline-code">pnpm install</Typography>
        .
      </Typography>
      <Typography variant="large">Are you absolutely sure?</Typography>
      <Typography variant="small">Email address</Typography>
      <Typography variant="muted">Enter your email address.</Typography>
    </article>
  ),
};

export const AsLink: Story = {
  render: () => (
    <Typography variant="small" render={<a href="#docs" />}>
      Documentation
    </Typography>
  ),
};
