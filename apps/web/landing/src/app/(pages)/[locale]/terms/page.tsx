import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { JsonLd } from "@/app/config/JsonLd";
import { buildAlternates } from "@/app/config/seo";
import { breadcrumbList, graph } from "@/app/config/structured-data";
import { LegalDocument } from "@/modules/legal/ui/LegalDocument";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]/terms">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "legal.terms" });

  return {
    title: t("title"),
    description: t("intro"),
    alternates: buildAlternates("terms", locale),
  };
}

export default async function TermsPage({
  params,
}: PageProps<"/[locale]/terms">) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: "legal.terms" }),
    getTranslations({ locale, namespace: "common" }),
  ]);

  return (
    <>
      <JsonLd
        data={graph(
          breadcrumbList([
            { name: tCommon("appName"), path: `/${locale}` },
            { name: t("title"), path: `/${locale}/terms` },
          ]),
        )}
      />
      <LegalDocument locale={locale} document="terms" />
    </>
  );
}
