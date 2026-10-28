import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { AdminTasks } from "@/modules/admin/public";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/tasks">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "admin.tasks" });
  return { title: t("title") };
}

export default function AdminTasksPage() {
  return <AdminTasks />;
}
