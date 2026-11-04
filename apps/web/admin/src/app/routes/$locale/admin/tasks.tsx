import { createFileRoute } from "@tanstack/react-router";
import { useTranslations } from "use-intl";

import { assertPermission } from "@/app/auth/guards";
import { cursorSearchSchema } from "@/app/config/search-schemas";
import { PageTitle } from "@/app/shell/PageTitle";
import { AdminTasks } from "@/modules/admin/public";

export const Route = createFileRoute("/$locale/admin/tasks")({
  validateSearch: cursorSearchSchema,
  beforeLoad: ({ context }) => {
    assertPermission(
      context.session?.roles ?? [],
      context.locale,
      "tasks.read",
    );
  },
  component: Page,
});

function Page() {
  const t = useTranslations("admin.tasks");
  return (
    <>
      <PageTitle title={t("title")} />
      <AdminTasks />
    </>
  );
}
