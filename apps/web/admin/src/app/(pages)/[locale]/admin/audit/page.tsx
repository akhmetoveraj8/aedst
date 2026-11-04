import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/modules/admin/entries/require-permission";
import { AuditLog } from "@/modules/admin/public";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/audit">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "admin.audit" });
  return { title: t("title") };
}

export default async function AdminAuditPage({
  params,
}: PageProps<"/[locale]/admin/audit">) {
  await requirePermission(requireLocale((await params).locale), "audit.read");
  return <AuditLog />;
}
