"use client";

import { useTranslations } from "next-intl";
import { useId } from "react";
import { Controller, useForm } from "react-hook-form";

import { PRIORITY_KEYS } from "@/modules/tasks/lib/labels";
import {
  CreateTaskRequestSchema,
  TaskPriority,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import {
  type AppErrorKind,
  errorMessageKey,
} from "@/shared/lib/errors/app-error";
import { protovalidateResolver } from "@/shared/lib/forms/protovalidate-resolver";
import { useHydrated } from "@/shared/lib/hooks/use-hydrated";
import { Button } from "@/shared/ui/button";
import { Field, FieldError, FieldLabel } from "@/shared/ui/field";
import { Form } from "@/shared/ui/form";
import { Input } from "@/shared/ui/input";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/shared/ui/select";
import { Textarea } from "@/shared/ui/textarea";

export type SettablePriority =
  | TaskPriority.LOW
  | TaskPriority.MEDIUM
  | TaskPriority.HIGH
  | TaskPriority.URGENT;

export type TaskFormValues = {
  title: string;
  description: string;
  priority: SettablePriority;
  dueDate: string; // yyyy-mm-dd from <input type="date">, or "".
};

// Validated with the server's own Protovalidate rules for CreateTaskRequest
// (tasks.proto, embedded in the generated descriptor), so the constraints live
// in one place. dueDate has no proto rules; update uses the same field rules.
const taskFormResolver = protovalidateResolver<
  typeof CreateTaskRequestSchema,
  TaskFormValues
>(CreateTaskRequestSchema, {
  toMessage: (values) => ({
    title: values.title.trim(),
    description: values.description,
    priority: values.priority,
  }),
});

/** Protovalidate rule id of the title violation -> message key. */
function titleErrorKey(ruleId: string) {
  return ruleId === "string.max_len" ? "titleTooLong" : "titleRequired";
}

const PRIORITY_OPTIONS: SettablePriority[] = [
  TaskPriority.LOW,
  TaskPriority.MEDIUM,
  TaskPriority.HIGH,
  TaskPriority.URGENT,
];

export function TaskForm({
  mode,
  defaultValues,
  onSubmit,
  isSubmitting,
  submitErrorKind,
  onCancel,
}: {
  mode: "create" | "edit";
  defaultValues?: Partial<TaskFormValues>;
  onSubmit: (values: TaskFormValues) => void;
  isSubmitting: boolean;
  /** Classified failure of the last submit; the server text is never shown. */
  submitErrorKind?: AppErrorKind;
  /** Shows a Cancel button (edit mode) that leaves the form without saving. */
  onCancel?: () => void;
}) {
  const id = useId();
  const titleId = `${id}-title`;
  const descriptionId = `${id}-description`;
  const priorityId = `${id}-priority`;
  const dueDateId = `${id}-dueDate`;
  const hydrated = useHydrated();
  const t = useTranslations("tasks.form");
  const tPriority = useTranslations("tasks.priority");
  const tErrors = useTranslations("common.errors");

  const {
    register,
    handleSubmit,
    control,
    formState: { errors },
  } = useForm<TaskFormValues>({
    resolver: taskFormResolver,
    defaultValues: {
      title: "",
      description: "",
      priority: TaskPriority.MEDIUM,
      dueDate: "",
      ...defaultValues,
    },
  });

  function priorityLabel(value: SettablePriority) {
    const key = PRIORITY_KEYS[value];
    return key ? tPriority(key) : "";
  }

  return (
    <Form
      onSubmit={handleSubmit((values) =>
        onSubmit({ ...values, title: values.title.trim() }),
      )}
      method="post"
      className="flex max-w-lg flex-col gap-4"
      noValidate
    >
      <Field>
        <FieldLabel htmlFor={titleId}>{t("titleLabel")}</FieldLabel>
        <Input
          id={titleId}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${titleId}-error` : undefined}
          {...register("title")}
        />
        {errors.title && (
          <FieldError id={`${titleId}-error`}>
            {t(titleErrorKey(errors.title.type))}
          </FieldError>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor={descriptionId}>{t("descriptionLabel")}</FieldLabel>
        <Textarea
          id={descriptionId}
          rows={4}
          aria-invalid={errors.description ? true : undefined}
          aria-describedby={
            errors.description ? `${descriptionId}-error` : undefined
          }
          {...register("description")}
        />
        {errors.description && (
          <FieldError id={`${descriptionId}-error`}>
            {t("descriptionTooLong")}
          </FieldError>
        )}
      </Field>

      <Field>
        <FieldLabel htmlFor={priorityId}>{t("priorityLabel")}</FieldLabel>
        <Controller
          control={control}
          name="priority"
          render={({ field }) => (
            <Select
              items={PRIORITY_OPTIONS.map((value) => ({
                value: String(value),
                label: priorityLabel(value),
              }))}
              value={String(field.value)}
              onValueChange={(value) =>
                field.onChange(Number(value) as SettablePriority)
              }
            >
              <SelectTrigger id={priorityId} onBlur={field.onBlur}>
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {PRIORITY_OPTIONS.map((value) => (
                  <SelectItem key={value} value={String(value)}>
                    {priorityLabel(value)}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          )}
        />
      </Field>

      <Field>
        <FieldLabel htmlFor={dueDateId}>
          {t("dueDateLabel")}{" "}
          <span className="text-muted-foreground">
            ({t("dueDateOptional")})
          </span>
        </FieldLabel>
        <Input id={dueDateId} type="date" {...register("dueDate")} />
      </Field>

      <div className="flex items-center gap-2">
        <Button type="submit" disabled={!hydrated || isSubmitting}>
          {mode === "create" ? t("create") : t("save")}
        </Button>
        {onCancel && (
          <Button type="button" variant="outline" onClick={onCancel}>
            {t("cancel")}
          </Button>
        )}
      </div>

      {submitErrorKind && (
        <p role="alert" className="text-destructive text-sm">
          {t("error", { message: tErrors(errorMessageKey(submitErrorKind)) })}
        </p>
      )}
    </Form>
  );
}
