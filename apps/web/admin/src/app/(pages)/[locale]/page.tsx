import { redirect } from "@/shared/i18n/navigation";
import { requireLocale } from "@/shared/i18n/require-locale";

/** The admin panel has no landing page: `/{locale}` is the overview. */
export default async function LocaleIndexPage({
  params,
}: PageProps<"/[locale]">) {
  const locale = requireLocale((await params).locale);
  redirect({ href: "/admin", locale });
}
