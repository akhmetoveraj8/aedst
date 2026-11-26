"use client";

import { cn } from "cn";
import * as React from "react";
import { Button } from "@/shared/ui/button";
import {
  Item,
  ItemActions,
  ItemContent,
  ItemDescription,
  ItemMedia,
  ItemTitle,
} from "@/shared/ui/item";

// Asks the person for a yes or no before a tool runs (shadcn AI Elements
// "Confirmation", Base UI pattern): an outline item with Deny / Approve
// buttons. The state mirrors a tool call's approval lifecycle without
// depending on the AI SDK; once answered, the Accepted / Rejected parts show.

type AiConfirmationState =
  | "approval-requested"
  | "approval-responded"
  | "output-denied"
  | "output-available";

type AiConfirmationApproval = {
  id: string;
  /** Unset until the person answers. */
  approved?: boolean;
  reason?: string;
};

type AiConfirmationValue = {
  state: AiConfirmationState;
  approval: AiConfirmationApproval;
};

const AiConfirmationContext = React.createContext<AiConfirmationValue | null>(
  null,
);

function useAiConfirmation(): AiConfirmationValue {
  const value = React.useContext(AiConfirmationContext);
  if (!value) {
    throw new Error(
      "AiConfirmation parts must be used inside <AiConfirmation>",
    );
  }
  return value;
}

type AiConfirmationProps = Omit<React.ComponentProps<typeof Item>, "render"> & {
  state: AiConfirmationState;
  /** Nothing renders until the tool call carries an approval. */
  approval?: AiConfirmationApproval;
};

function AiConfirmation({
  state,
  approval,
  className,
  ...props
}: AiConfirmationProps) {
  const value = React.useMemo(
    () => (approval ? { state, approval } : null),
    [state, approval],
  );
  if (!value) return null;
  return (
    <AiConfirmationContext.Provider value={value}>
      <Item
        variant="outline"
        size="sm"
        role="group"
        data-state={state}
        className={className}
        {...props}
      />
    </AiConfirmationContext.Provider>
  );
}

function AiConfirmationMedia(props: React.ComponentProps<typeof ItemMedia>) {
  return <ItemMedia variant="icon" {...props} />;
}

function AiConfirmationContent(
  props: React.ComponentProps<typeof ItemContent>,
) {
  return <ItemContent {...props} />;
}

function AiConfirmationTitle(props: React.ComponentProps<typeof ItemTitle>) {
  return <ItemTitle {...props} />;
}

function AiConfirmationDescription(
  props: React.ComponentProps<typeof ItemDescription>,
) {
  return <ItemDescription {...props} />;
}

/** Children show only while the approval is pending. */
function AiConfirmationRequest({ children }: { children?: React.ReactNode }) {
  const { state } = useAiConfirmation();
  return state === "approval-requested" ? children : null;
}

function isAnswered(state: AiConfirmationState) {
  return state !== "approval-requested";
}

/** Children show once the person approved. */
function AiConfirmationAccepted({ children }: { children?: React.ReactNode }) {
  const { state, approval } = useAiConfirmation();
  return isAnswered(state) && approval.approved === true ? children : null;
}

/** Children show once the person denied (or the output was denied). */
function AiConfirmationRejected({ children }: { children?: React.ReactNode }) {
  const { state, approval } = useAiConfirmation();
  const denied = state === "output-denied" || approval.approved === false;
  return isAnswered(state) && denied ? children : null;
}

/** Deny / Approve buttons; hidden once the approval is answered. */
function AiConfirmationActions({
  className,
  ...props
}: React.ComponentProps<typeof ItemActions>) {
  const { state } = useAiConfirmation();
  if (state !== "approval-requested") return null;
  return <ItemActions className={cn("gap-2", className)} {...props} />;
}

function AiConfirmationAction({
  size = "sm",
  ...props
}: React.ComponentProps<typeof Button>) {
  return <Button size={size} {...props} />;
}

export {
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
};
