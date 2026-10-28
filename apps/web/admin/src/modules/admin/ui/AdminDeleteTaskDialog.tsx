"use client";

import { createConnectQueryKey, useMutation } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { AdminService } from "@/shared/api/connect/client";
import {
  type AdminTask,
  DeleteTaskRequestSchema,
} from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import { track } from "@/shared/lib/analytics/analytics";
import { protovalidateResolver } from "@/shared/lib/forms/protovalidate-resolver";
import { Button } from "@/shared/ui/button";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from "@/shared/ui/dialog";
import { Field, FieldError, FieldLabel } from "@/shared/ui/field";
import { Form } from "@/shared/ui/form";
import { Textarea } from "@/shared/ui/textarea";

type DeleteValues = { reason: string };

// Same Protovalidate rules as admin.proto's DeleteTaskRequest (reason 3..500);
// the task id is supplied at submit time, not collected by the form.
const deleteResolver = protovalidateResolver<
  typeof DeleteTaskRequestSchema,
  DeleteValues
>(DeleteTaskRequestSchema, {
  toMessage: (values) => ({ reason: values.reason.trim() }),
  omit: ["id"],
});

/** Delete-with-reason dialog; loaded on the first click of "Delete". */
export function AdminDeleteTaskDialog({
  task,
  open,
  onClose,
}: {
  task: AdminTask;
  open: boolean;
  onClose: () => void;
}) {
  const t = useTranslations("admin.tasks");
  const reasonId = useId();
  const queryClient = useQueryClient();
  const form = useForm<DeleteValues>({
    resolver: deleteResolver,
    defaultValues: { reason: "" },
  });
  const remove = useMutation(AdminService.method.deleteTask, {
    meta: { feature: "admin" },
    onSuccess: async () => {
      track("admin_task_deleted");
      form.reset();
      onClose();
      await queryClient.invalidateQueries({
        queryKey: createConnectQueryKey({
          schema: AdminService,
          cardinality: undefined,
        }),
      });
    },
  });

  return (
    <Dialog
      open={open}
      onOpenChange={(open) => {
        if (!open) {
          form.reset();
          onClose();
        }
      }}
    >
      <DialogContent>
        <Form
          noValidate
          onSubmit={form.handleSubmit((values) => {
            remove.mutate({ id: task.id, reason: values.reason.trim() });
          })}
          className="flex flex-col gap-4"
        >
          <DialogHeader>
            <DialogTitle>{t("deleteTitle")}</DialogTitle>
            <DialogDescription>
              {t("deleteDescription", { title: task.title })}
            </DialogDescription>
          </DialogHeader>
          <Field data-invalid={Boolean(form.formState.errors.reason)}>
            <FieldLabel htmlFor={reasonId}>{t("reason")}</FieldLabel>
            <Textarea
              id={reasonId}
              aria-invalid={Boolean(form.formState.errors.reason)}
              aria-describedby={
                form.formState.errors.reason ? `${reasonId}-error` : undefined
              }
              {...form.register("reason")}
            />
            {form.formState.errors.reason && (
              <FieldError id={`${reasonId}-error`}>
                {t("reasonInvalid")}
              </FieldError>
            )}
          </Field>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t("cancel")}
            </Button>
            <Button
              type="submit"
              variant="destructive"
              disabled={remove.isPending}
            >
              {t("confirmDelete")}
            </Button>
          </DialogFooter>
        </Form>
      </DialogContent>
    </Dialog>
  );
}
