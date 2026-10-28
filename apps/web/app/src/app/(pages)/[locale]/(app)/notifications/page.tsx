import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotificationsInbox } from "@/modules/notifications/entries/notifications-inbox";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/notifications">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "notifications.inbox" });
  return { title: t("title") };
}

export default function NotificationsPage() {
  return <NotificationsInbox />;
}
