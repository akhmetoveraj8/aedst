import { CommandLineIcon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import type { Meta, StoryObj } from "@storybook/nextjs-vite";
import { useState } from "react";
import { expect, userEvent, within } from "storybook/test";

import {
  AiConfirmation,
  AiConfirmationAccepted,
  AiConfirmationAction,
  AiConfirmationActions,
  type AiConfirmationApproval,
  AiConfirmationContent,
  AiConfirmationDescription,
  AiConfirmationMedia,
  AiConfirmationRejected,
  AiConfirmationRequest,
  type AiConfirmationState,
  AiConfirmationTitle,
} from "@/shared/ui/ai-confirmation";

function ConfirmationDemo({
  initialState = "approval-requested",
  initialApproved,
}: {
  initialState?: AiConfirmationState;
  initialApproved?: boolean;
}) {
  const [state, setState] = useState<AiConfirmationState>(initialState);
  const [approval, setApproval] = useState<AiConfirmationApproval>({
    id: "call-1",
    approved: initialApproved,
  });
  const answer = (approved: boolean) => {
    setApproval({ id: "call-1", approved });
    setState(approved ? "output-available" : "output-denied");
  };
  return (
    <AiConfirmation state={state} approval={approval} className="max-w-md">
      <AiConfirmationMedia>
        <HugeiconsIcon icon={CommandLineIcon} strokeWidth={2} />
      </AiConfirmationMedia>
      <AiConfirmationContent>
        <AiConfirmationTitle>
          <AiConfirmationRequest>Run rm -rf dist?</AiConfirmationRequest>
          <AiConfirmationAccepted>Approved: rm -rf dist</AiConfirmationAccepted>
          <AiConfirmationRejected>Denied: rm -rf dist</AiConfirmationRejected>
        </AiConfirmationTitle>
        <AiConfirmationDescription>
          The command runs in this project.
        </AiConfirmationDescription>
      </AiConfirmationContent>
      <AiConfirmationActions>
        <AiConfirmationAction variant="outline" onClick={() => answer(false)}>
          Deny
        </AiConfirmationAction>
        <AiConfirmationAction onClick={() => answer(true)}>
          Approve
        </AiConfirmationAction>
      </AiConfirmationActions>
    </AiConfirmation>
  );
}

const meta = {
  title: "UI/AI/Confirmation",
  component: AiConfirmation,
  args: { state: "approval-requested" },
  render: () => <ConfirmationDemo />,
} satisfies Meta<typeof AiConfirmation>;

export default meta;
type Story = StoryObj<typeof meta>;

export const Default: Story = {
  play: async ({ canvasElement }) => {
    const canvas = within(canvasElement);
    await userEvent.click(canvas.getByRole("button", { name: "Approve" }));
    await expect(canvas.getByText("Approved: rm -rf dist")).toBeInTheDocument();
    await expect(canvas.queryByRole("button", { name: "Deny" })).toBeNull();
  },
};

export const Rejected: Story = {
  render: () => (
    <ConfirmationDemo initialState="output-denied" initialApproved={false} />
  ),
};
