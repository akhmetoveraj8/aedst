import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { JsonLd } from "@/app/config/json-ld";
import { buildAlternates } from "@/app/config/seo";
import {
  faqPage,
  graph,
  softwareApplication,
} from "@/app/config/structured-data";
import { signInUrl } from "@/modules/marketing/entries/app-links";
import { CtaSection } from "@/modules/marketing/entries/cta-section";
import {
  FaqSection,
  getFaqEntries,
} from "@/modules/marketing/entries/faq-section";
import { Features } from "@/modules/marketing/entries/features";
import { Hero } from "@/modules/marketing/entries/hero";
import { HowItWorks } from "@/modules/marketing/entries/how-it-works";
import { Pricing } from "@/modules/marketing/entries/pricing";
import { toLanguageTag } from "@/shared/i18n/locales";
import { requireLocale } from "@/shared/i18n/require-locale";

export async function generateMetadata({
  params,
}: PageProps<"/[locale]">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const [t, tCommon] = await Promise.all([
    getTranslations({ locale, namespace: "marketing.meta" }),
    getTranslations({ locale, namespace: "common" }),
  ]);

  return {
    // Explicit: a layout's title template never applies to a page of the same segment.
    title: `${t("title")} · ${tCommon("appName")}`,
    description: tCommon("appDescription"),
    alternates: buildAlternates("", locale),
  };
}

export default async function HomePage({ params }: PageProps<"/[locale]">) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);

  const [tCommon, faqEntries] = await Promise.all([
    getTranslations({ locale, namespace: "common" }),
    getFaqEntries(locale),
  ]);

  return (
    <>
      <JsonLd
        data={graph(
          softwareApplication({
            locale,
            inLanguage: toLanguageTag(locale),
            name: tCommon("appName"),
            description: tCommon("appDescription"),
            appUrl: signInUrl(locale),
          }),
          faqPage(faqEntries),
        )}
      />
      <Hero locale={locale} />
      <Features locale={locale} />
      <HowItWorks locale={locale} />
      <Pricing locale={locale} />
      <FaqSection locale={locale} />
      <CtaSection locale={locale} />
    </>
  );
}
