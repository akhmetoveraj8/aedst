import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { NotificationPreferences } from "@/modules/notifications/entries/notification-preferences";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/notifications/preferences">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({
    locale,
    namespace: "notifications.preferences",
  });
  return { title: t("metaTitle") };
}

export default function NotificationPreferencesPage() {
  return <NotificationPreferences />;
}
