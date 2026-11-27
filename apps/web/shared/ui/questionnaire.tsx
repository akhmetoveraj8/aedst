"use client";

import { Tick02Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { Questionnaire as QuestionnairePrimitive } from "@shadcn/react/questionnaire";
import { cn } from "cn";
import type * as React from "react";
import { useTranslations } from "use-intl";
import { withSlot } from "@/shared/lib/utils/with-slot";
import type { Button } from "@/shared/ui/button";
import {
  ChoiceDot,
  ChoiceIndicator,
  ChoiceInput,
  ChoiceLabel,
  ChoiceShortcut,
  navButton,
} from "@/shared/ui/questionnaire-parts";

const Questionnaire = withSlot(
  QuestionnairePrimitive.Root,
  "questionnaire",
  "flex w-full min-w-0 flex-col gap-4",
);

function QuestionnaireProgress({
  className,
  children,
  render,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Progress>) {
  // The primitive's built-in name and "Question N of M" text are English;
  // the kit supplies them from the catalogue instead.
  const t = useTranslations("common.a11y");
  return (
    <QuestionnairePrimitive.Progress
      data-slot="questionnaire-progress"
      aria-label={t("questionnaireProgress")}
      render={
        render ??
        ((renderProps, state) => {
          const text = state.total
            ? t("questionProgress", {
                current: state.current,
                total: state.total,
              })
            : undefined;
          return (
            <div {...renderProps} role="progressbar" aria-valuetext={text}>
              {children ?? text}
            </div>
          );
        })
      }
      className={cn(
        "min-h-[1lh] w-fit min-w-[14ch] text-xs font-medium text-muted-foreground tabular-nums",
        className,
      )}
      {...props}
    />
  );
}

const QuestionnaireItem = withSlot(
  QuestionnairePrimitive.Item,
  "questionnaire-item",
  "flex min-w-0 flex-col gap-4 border-0 p-0 outline-none",
);

const QuestionnaireTitle = withSlot(
  QuestionnairePrimitive.Title,
  "questionnaire-title",
  "font-heading text-base leading-snug font-medium text-pretty [&:not(:has(~[data-slot=questionnaire-description]))]:mb-4",
);

const QuestionnaireDescription = withSlot(
  QuestionnairePrimitive.Description,
  "questionnaire-description",
  "text-sm text-pretty text-muted-foreground",
);

const QuestionnaireChoices = withSlot(
  QuestionnairePrimitive.Choices,
  "questionnaire-choices",
  "group/questionnaire-choices grid min-w-0 gap-2",
);

function QuestionnaireChoice({
  children,
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Choice>) {
  return (
    <QuestionnairePrimitive.Choice
      data-slot="questionnaire-choice"
      className={cn(
        "group/questionnaire-choice relative flex min-h-11 cursor-pointer items-start gap-2.5 rounded-lg border border-input bg-transparent px-3 py-2.5 text-start text-sm transition-colors outline-none select-none hover:bg-muted/50 has-[>input:focus-visible]:border-ring has-[>input:focus-visible]:ring-3 has-[>input:focus-visible]:ring-ring data-invalid:border-destructive dark:bg-input/20 data-checked:border-primary/40 data-checked:bg-muted dark:data-checked:bg-muted motion-reduce:transition-none",
        "data-disabled:pointer-events-none data-disabled:cursor-not-allowed data-disabled:opacity-50",
        className,
      )}
      {...props}
    >
      <ChoiceInput />
      <ChoiceIndicator aria-hidden="true">
        <ChoiceDot />
        <HugeiconsIcon
          icon={Tick02Icon}
          strokeWidth={2}
          data-slot="questionnaire-choice-indicator-check"
          className="hidden size-3.5 group-data-[type=radio]/questionnaire-choice:hidden group-data-checked/questionnaire-choice:block"
        />
      </ChoiceIndicator>
      <ChoiceLabel>{children}</ChoiceLabel>
      <ChoiceShortcut />
    </QuestionnairePrimitive.Choice>
  );
}

const QuestionnaireChoiceDescription = withSlot(
  "span",
  "questionnaire-choice-description",
  "text-muted-foreground",
);

function QuestionnaireInput({
  className,
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Input>) {
  return (
    <div
      data-slot="questionnaire-input-wrapper"
      className="group/questionnaire-input relative w-full min-w-0"
    >
      <QuestionnairePrimitive.Input
        data-slot="questionnaire-input"
        className={cn(
          "h-8 min-h-11 w-full min-w-0 rounded-lg border border-input bg-transparent px-2.5 py-1 text-base transition-[color,box-shadow,background-color] motion-reduce:transition-none outline-none focus-visible:border-ring focus-visible:ring-3 focus-visible:ring-ring disabled:pointer-events-none disabled:cursor-not-allowed disabled:bg-input/50 disabled:opacity-50 aria-invalid:border-destructive aria-invalid:ring-3 aria-invalid:ring-destructive/20 focus-visible:aria-invalid:ring-destructive sm:min-h-0 md:text-sm dark:bg-input/30 dark:disabled:bg-input/80 dark:aria-invalid:border-destructive/50 dark:aria-invalid:ring-destructive/40 dark:focus-visible:aria-invalid:ring-destructive",
          "selection:bg-primary selection:text-primary-foreground placeholder:text-muted-foreground",
          className,
        )}
        {...props}
      />
    </div>
  );
}

const QuestionnaireError = withSlot(
  QuestionnairePrimitive.Error,
  "questionnaire-error",
  "mt-2 text-sm text-destructive",
);

const QuestionnaireActions = withSlot(
  "div",
  "questionnaire-actions",
  "grid min-h-11 w-full grid-cols-[minmax(0,1fr)_auto_auto] items-center gap-2 sm:min-h-8",
);

type NavButtonProps = Pick<
  React.ComponentProps<typeof Button>,
  "size" | "variant"
> & {
  /** The visible text, worded by the caller (the kit hardcodes none). */
  children: React.ReactNode;
};

function QuestionnairePrevious({
  children,
  className,
  size = "default",
  variant = "outline",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Previous> &
  NavButtonProps) {
  return (
    <QuestionnairePrimitive.Previous
      {...navButton(
        "previous",
        size,
        variant,
        "col-start-1 justify-self-start",
        className,
      )}
      {...props}
    >
      {children}
    </QuestionnairePrimitive.Previous>
  );
}

function QuestionnaireSkip({
  children,
  className,
  size = "default",
  variant = "outline",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Skip> & NavButtonProps) {
  return (
    <QuestionnairePrimitive.Skip
      {...navButton(
        "skip",
        size,
        variant,
        "col-start-2 justify-self-end",
        className,
      )}
      {...props}
    >
      {children}
    </QuestionnairePrimitive.Skip>
  );
}

function QuestionnaireNext({
  children,
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Next> & NavButtonProps) {
  return (
    <QuestionnairePrimitive.Next
      {...navButton(
        "next",
        size,
        variant,
        "col-start-3 justify-self-end",
        className,
      )}
      {...props}
    >
      {children}
    </QuestionnairePrimitive.Next>
  );
}

function QuestionnaireSubmit({
  children,
  className,
  size = "default",
  variant = "default",
  ...props
}: React.ComponentProps<typeof QuestionnairePrimitive.Submit> &
  NavButtonProps) {
  return (
    <QuestionnairePrimitive.Submit
      {...navButton(
        "submit",
        size,
        variant,
        "col-start-3 justify-self-end",
        className,
      )}
      {...props}
    >
      {children}
    </QuestionnairePrimitive.Submit>
  );
}

export {
  Questionnaire,
  QuestionnaireActions,
  QuestionnaireChoice,
  QuestionnaireChoiceDescription,
  QuestionnaireChoices,
  QuestionnaireDescription,
  QuestionnaireError,
  QuestionnaireInput,
  QuestionnaireItem,
  QuestionnaireNext,
  QuestionnairePrevious,
  QuestionnaireProgress,
  QuestionnaireSkip,
  QuestionnaireSubmit,
  QuestionnaireTitle,
};
