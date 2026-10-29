import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { requirePermission } from "@/modules/admin/entries/require-permission";
import { AdminUsers } from "@/modules/admin/public";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/users">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "admin.users" });
  return { title: t("title") };
}

export default async function AdminUsersPage({
  params,
}: PageProps<"/[locale]/admin/users">) {
  await requirePermission(requireLocale((await params).locale), "users.read");
  return <AdminUsers />;
}
