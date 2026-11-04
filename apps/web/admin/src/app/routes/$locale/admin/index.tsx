import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { assertPermission } from "@/app/auth/guards";
import { PageTitle } from "@/app/shell/PageTitle";
import { AdminOverview } from "@/modules/admin/public";

export const Route = createFileRoute("/$locale/admin/")({
  beforeLoad: ({ context }) => {
    assertPermission(
      context.session?.roles ?? [],
      context.locale,
      "overview.read",
    );
  },
  component: Page,
});

function Page() {
  const t = useTranslations("admin.overview");
  return (
    <>
      <PageTitle title={t("title")} />
      <AdminOverview />
    </>
  );
}
