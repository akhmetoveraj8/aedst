import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { assertPermission } from "@/app/auth/guards";
import { cursorSearchSchema } from "@/app/config/search-schemas";
import { PageTitle } from "@/app/shell/PageTitle";
import { AuditLog } from "@/modules/admin/public";

export const Route = createFileRoute("/$locale/admin/audit")({
  validateSearch: cursorSearchSchema,
  beforeLoad: ({ context }) => {
    assertPermission(
      context.session?.roles ?? [],
      context.locale,
      "audit.read",
    );
  },
  component: Page,
});

function Page() {
  const t = useTranslations("admin.audit");
  return (
    <>
      <PageTitle title={t("title")} />
      <AuditLog />
    </>
  );
}
