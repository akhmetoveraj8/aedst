import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { BroadcastForm } from "@/modules/admin/public";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/admin/broadcast">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "admin.broadcast" });
  return { title: t("title") };
}

export default function AdminBroadcastPage() {
  return <BroadcastForm />;
}
