import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/modules/admin/entries/require-permission";
import { AdminOverview } from "@/modules/admin/public";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "admin.overview" });
  return { title: t("title") };
}

export default async function AdminOverviewPage({
  params,
}: PageProps<"/[locale]/admin">) {
  await requirePermission(
    requireLocale((await params).locale),
    "overview.read",
  );
  return <AdminOverview />;
}
