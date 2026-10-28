import type { Metadata } from "next";
import { getTranslations } from "next-intl/server";
import { SearchPage as SearchView } from "@/modules/search/public";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/search">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "search" });
  return { title: t("metaTitle") };
}

export default function SearchPage() {
  return <SearchView />;
}
