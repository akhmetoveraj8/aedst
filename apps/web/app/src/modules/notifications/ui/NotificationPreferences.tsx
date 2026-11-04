"use client";

import { create } from "@bufbuild/protobuf";
import {
  createConnectQueryKey,
  useMutation,
  useQuery,
} from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import { useTranslations } from "next-intl";
import { useId } from "react";
import { toast } from "sonner";

import { PushOptIn } from "@/modules/notifications/ui/PushOptIn";
import { NotificationsService } from "@/shared/api/connect/client";
import {
  GetPreferencesResponseSchema,
  type Preferences,
} from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { Button } from "@/shared/ui/button";
import { Label } from "@/shared/ui/label";
import { LoadingSkeleton } from "@/shared/ui/loading-skeleton";

import { Switch } from "@/shared/ui/switch";

const TOGGLES = [
  "pushEnabled",
  "taskCompleted",
  "taskDueSoon",
  "mediaReady",
] as const satisfies ReadonlyArray<keyof Preferences>;

type Toggle = (typeof TOGGLES)[number];

/**
 * Which notifications this user gets. Each switch saves immediately with an
 * optimistic update (rolled back, with a toast, if the server refuses).
 */
export function NotificationPreferences() {
  const t = useTranslations("notifications.preferences");
  const queryClient = useQueryClient();
  const preferences = useQuery(
    NotificationsService.method.getPreferences,
    {},
    { meta: { feature: "notifications" } },
  );
  const queryKey = createConnectQueryKey({
    schema: NotificationsService.method.getPreferences,
    input: {},
    cardinality: "finite",
  });

  const update = useMutation(NotificationsService.method.updatePreferences, {
    meta: { feature: "notifications" },
    onMutate: async (variables) => {
      await queryClient.cancelQueries({ queryKey });
      const previous = queryClient.getQueryData(queryKey);
      queryClient.setQueryData(
        queryKey,
        create(GetPreferencesResponseSchema, {
          preferences: variables.preferences,
        }),
      );
      return { previous };
    },
    onError: (_error, _variables, context) => {
      queryClient.setQueryData(queryKey, context?.previous);
    },
    onSuccess: (data) => {
      queryClient.setQueryData(
        queryKey,
        create(GetPreferencesResponseSchema, { preferences: data.preferences }),
      );
      toast.success(t("saved"), { id: "notification-preferences" });
    },
  });

  const current = preferences.data?.preferences;

  return (
    <div className="flex max-w-xl flex-col gap-6">
      <h1 className="font-semibold text-2xl">{t("title")}</h1>

      <PushOptIn />

      <section
        aria-labelledby="kinds-heading"
        className="flex flex-col gap-4 rounded-lg border p-4"
      >
        <h2 id="kinds-heading" className="font-medium">
          {t("kindsTitle")}
        </h2>
        {preferences.isPending ? (
          <LoadingSkeleton className="h-32 w-full" />
        ) : preferences.isError || !current ? (
          <div role="alert" className="flex flex-col items-start gap-2">
            <p className="text-sm">{t("loadError")}</p>
            <Button variant="outline" onClick={() => preferences.refetch()}>
              {t("retry")}
            </Button>
          </div>
        ) : (
          TOGGLES.map((toggle) => (
            <PreferenceSwitch
              key={toggle}
              toggle={toggle}
              label={t(`toggles.${toggle}`)}
              checked={current[toggle]}
              disabled={
                update.isPending ||
                (toggle !== "pushEnabled" && !current.pushEnabled)
              }
              onChange={(value) =>
                update.mutate({ preferences: { ...current, [toggle]: value } })
              }
            />
          ))
        )}
      </section>
    </div>
  );
}

function PreferenceSwitch({
  toggle,
  label,
  checked,
  disabled,
  onChange,
}: {
  toggle: Toggle;
  label: string;
  checked: boolean;
  disabled: boolean;
  onChange: (value: boolean) => void;
}) {
  const id = useId();
  return (
    <div className="flex items-center justify-between gap-4">
      <Label htmlFor={id} className="font-normal">
        {label}
      </Label>
      <Switch
        id={id}
        // Named explicitly: WebKit does not associate a <label for> with the
        // non-form element a switch renders.
        aria-label={label}
        name={toggle}
        checked={checked}
        disabled={disabled}
        onCheckedChange={onChange}
      />
    </div>
  );
}
