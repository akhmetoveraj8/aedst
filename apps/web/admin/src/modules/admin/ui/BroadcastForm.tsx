"use client";

import { useMutation } from "@connectrpc/connect-query";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { useForm } from "react-hook-form";
import { toast } from "sonner";

import { AdminService } from "@/shared/api/connect/client";
import { BroadcastNotificationRequestSchema } from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import { track } from "@/shared/lib/analytics/analytics";
import { protovalidateResolver } from "@/shared/lib/forms/protovalidate-resolver";
import { useHydrated } from "@/shared/lib/hooks/use-hydrated";
import { Button } from "@/shared/ui/button";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldLabel,
} from "@/shared/ui/field";
import { Form } from "@/shared/ui/form";
import { Input } from "@/shared/ui/input";
import { Textarea } from "@/shared/ui/textarea";

type BroadcastValues = {
  userId: string;
  title: string;
  body: string;
  link: string;
};

// Same Protovalidate rules as the server's BroadcastNotificationRequest
// (admin.proto): uuid-or-empty user id, title 1..120, body <= 1000, local link.
const broadcastResolver = protovalidateResolver<
  typeof BroadcastNotificationRequestSchema,
  BroadcastValues
>(BroadcastNotificationRequestSchema, {
  toMessage: (values) => ({
    userId: values.userId.trim(),
    title: values.title.trim(),
    body: values.body,
    link: values.link,
  }),
});

/** Sends a SYSTEM notification to one user, or everyone when no user id is given. */
export function BroadcastForm() {
  const t = useTranslations("admin.broadcast");
  const hydrated = useHydrated();
  const ids = { user: useId(), title: useId(), body: useId(), link: useId() };
  const form = useForm<BroadcastValues>({
    resolver: broadcastResolver,
    defaultValues: { userId: "", title: "", body: "", link: "" },
  });
  const broadcast = useMutation(AdminService.method.broadcastNotification, {
    meta: { feature: "admin" },
    onSuccess: (data, variables) => {
      track("admin_broadcast_sent", {
        audience: variables.userId ? "user" : "everyone",
      });
      toast.success(t("sent", { count: Number(data.recipients) }));
      form.reset();
    },
  });
  const errors = form.formState.errors;

  return (
    <Form
      noValidate
      className="flex max-w-xl flex-col gap-4"
      onSubmit={form.handleSubmit((values) =>
        broadcast.mutate({
          userId: values.userId.trim(),
          title: values.title.trim(),
          body: values.body,
          link: values.link,
        }),
      )}
    >
      <Field data-invalid={Boolean(errors.userId)}>
        <FieldLabel htmlFor={ids.user}>{t("userId")}</FieldLabel>
        <Input
          id={ids.user}
          autoComplete="off"
          aria-invalid={errors.userId ? true : undefined}
          aria-describedby={errors.userId ? `${ids.user}-error` : undefined}
          {...form.register("userId")}
        />
        <FieldDescription>{t("userIdHint")}</FieldDescription>
        {errors.userId && (
          <FieldError id={`${ids.user}-error`}>{t("userIdInvalid")}</FieldError>
        )}
      </Field>
      <Field data-invalid={Boolean(errors.title)}>
        <FieldLabel htmlFor={ids.title}>{t("titleLabel")}</FieldLabel>
        <Input
          id={ids.title}
          aria-invalid={errors.title ? true : undefined}
          aria-describedby={errors.title ? `${ids.title}-error` : undefined}
          {...form.register("title")}
        />
        {errors.title && (
          <FieldError id={`${ids.title}-error`}>
            {t(
              errors.title.type === "string.max_len"
                ? "titleTooLong"
                : "titleRequired",
            )}
          </FieldError>
        )}
      </Field>
      <Field data-invalid={Boolean(errors.body)}>
        <FieldLabel htmlFor={ids.body}>{t("body")}</FieldLabel>
        <Textarea
          id={ids.body}
          aria-invalid={errors.body ? true : undefined}
          aria-describedby={errors.body ? `${ids.body}-error` : undefined}
          {...form.register("body")}
        />
        {errors.body && (
          <FieldError id={`${ids.body}-error`}>{t("bodyInvalid")}</FieldError>
        )}
      </Field>
      <Field data-invalid={Boolean(errors.link)}>
        <FieldLabel htmlFor={ids.link}>{t("link")}</FieldLabel>
        <Input
          id={ids.link}
          placeholder="/tasks"
          aria-invalid={errors.link ? true : undefined}
          aria-describedby={errors.link ? `${ids.link}-error` : undefined}
          {...form.register("link")}
        />
        <FieldDescription>{t("linkHint")}</FieldDescription>
        {errors.link && (
          <FieldError id={`${ids.link}-error`}>{t("linkInvalid")}</FieldError>
        )}
      </Field>
      <Button
        type="submit"
        className="w-fit"
        disabled={!hydrated || broadcast.isPending}
      >
        {t("send")}
      </Button>
    </Form>
  );
}
