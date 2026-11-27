import { Questionnaire as QuestionnairePrimitive } from "@shadcn/react/questionnaire";
import { cn } from "cn";
import type * as React from "react";
import { withSlot } from "@/shared/lib/utils/with-slot";
import { type Button, buttonVariants } from "@/shared/ui/button";

type ButtonProps = React.ComponentProps<typeof Button>;

// Internal parts of `questionnaire.tsx` (kept apart for file size; not public).
const ChoiceInput = withSlot(
  QuestionnairePrimitive.ChoiceInput,
  "questionnaire-choice-input",
  "absolute inset-0 z-10 size-full cursor-pointer opacity-0",
);
const ChoiceIndicator = withSlot(
  "span",
  "questionnaire-choice-indicator",
  "pointer-events-none relative flex size-4 shrink-0 translate-y-[--spacing(0.45)] items-center justify-center rounded-[4px] border border-input group-has-data-[slot=questionnaire-choice-description]/questionnaire-choice:translate-y-0.5 group-data-[type=radio]/questionnaire-choice:rounded-full group-data-checked/questionnaire-choice:border-primary group-data-checked/questionnaire-choice:bg-primary group-data-checked/questionnaire-choice:text-primary-foreground dark:bg-input/30 dark:group-data-checked/questionnaire-choice:bg-primary",
);
const ChoiceDot = withSlot(
  "span",
  "questionnaire-choice-indicator-dot",
  "hidden size-2 rounded-full bg-primary-foreground group-data-[type=checkbox]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block",
);
const ChoiceLabel = withSlot(
  QuestionnairePrimitive.ChoiceLabel,
  "questionnaire-choice-label",
  "flex min-w-0 flex-1 flex-col gap-0.5 leading-snug",
);
const ChoiceShortcut = withSlot(
  QuestionnairePrimitive.ChoiceShortcut,
  "questionnaire-choice-shortcut",
  "pointer-events-none ms-auto hidden size-5 shrink-0 translate-y-[--spacing(0.45)] items-center justify-center rounded-md border border-input bg-background font-mono text-[0.625rem] leading-none font-medium text-muted-foreground group-has-data-[slot=questionnaire-choice-description]/questionnaire-choice:translate-y-0.5 group-data-[shortcut]/questionnaire-choice:inline-flex",
);

/** Slot, button look and grid cell shared by the four navigation buttons. */
function navButton(
  slot: string,
  size: ButtonProps["size"],
  variant: ButtonProps["variant"],
  cell: string,
  className: unknown,
) {
  return {
    "data-slot": `questionnaire-${slot}`,
    "data-size": size,
    "data-variant": variant,
    className: cn(
      buttonVariants({ size, variant }),
      "row-start-1 min-h-11 sm:min-h-0",
      cell,
      className as string | undefined,
    ),
  };
}

export {
  ChoiceDot,
  ChoiceIndicator,
  ChoiceInput,
  ChoiceLabel,
  ChoiceShortcut,
  navButton,
};
