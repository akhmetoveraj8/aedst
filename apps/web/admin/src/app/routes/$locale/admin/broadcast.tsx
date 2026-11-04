import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { assertPermission } from "@/app/auth/guards";
import { PageTitle } from "@/app/shell/PageTitle";
import { BroadcastForm } from "@/modules/admin/public";

export const Route = createFileRoute("/$locale/admin/broadcast")({
  beforeLoad: ({ context }) => {
    assertPermission(
      context.session?.roles ?? [],
      context.locale,
      "notifications.broadcast",
    );
  },
  component: Page,
});

function Page() {
  const t = useTranslations("admin.broadcast");
  return (
    <>
      <PageTitle title={t("title")} />
      <BroadcastForm />
    </>
  );
}
