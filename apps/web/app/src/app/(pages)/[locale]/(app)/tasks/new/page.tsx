import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { CreateTaskPage } from "@/modules/tasks/public";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/tasks/new">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "tasks.form" });
  return { title: t("createTitle") };
}

export default function NewTaskPage() {
  return <CreateTaskPage />;
}
