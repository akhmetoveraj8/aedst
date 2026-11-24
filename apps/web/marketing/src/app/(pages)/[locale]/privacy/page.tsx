import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { JsonLd } from "@/app/config/json-ld";
import { buildAlternates, buildOpenGraph } from "@/app/config/seo";
import { breadcrumbList, graph } from "@/app/config/structured-data";
import { LegalDocument } from "@/modules/legal/entries/legal-document";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/privacy">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: "legal.privacy" }),
    getTranslations({ locale, namespace: "common" }),
  ]);

  return {
    title: t("title"),
    description: t("intro"),
    alternates: buildAlternates("privacy", locale),
    openGraph: buildOpenGraph("privacy", locale, {
      siteName: tCommon("appName"),
      title: t("title"),
      description: t("intro"),
    }),
  };
}

export default async function PrivacyPage({
  params,
}: PageProps<"/[locale]/privacy">) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: "legal.privacy" }),
    getTranslations({ locale, namespace: "common" }),
  ]);

  return (
    <>
      <JsonLd
        data={graph(
          breadcrumbList([
            { name: tCommon("appName"), path: `/${locale}` },
            { name: t("title"), path: `/${locale}/privacy` },
          ]),
        )}
      />
      <LegalDocument locale={locale} document="privacy" />
    </>
  );
}
