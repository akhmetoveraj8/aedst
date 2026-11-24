import { getTranslations } from "next-intl/server";
import type { Locale } from "@/shared/i18n/locales";
import { faqKeys } from "../lib/content-keys";
import { FaqAccordion } from "./faq-accordion";

/** FAQ entries, shared by the section and the FAQPage JSON-LD on the home page. */
export async function getFaqEntries(locale: Locale) {
  const t = await getTranslations({ locale, namespace: "marketing.faq" });
  return faqKeys.map((key) => ({
    key,
    question: t(`items.${key}.question`),
    answer: t(`items.${key}.answer`),
  }));
}

export async function FaqSection({ locale }: { locale: Locale }) {
  const [t, entries] = await Promise.all([
    getTranslations({ locale, namespace: "marketing.faq" }),
    getFaqEntries(locale),
  ]);

  return (
    <section
      id="faq"
      aria-labelledby="faq-title"
      className="mx-auto w-full max-w-3xl scroll-mt-20 px-4 py-16"
    >
      <h2
        id="faq-title"
        className="mb-8 text-center font-semibold text-3xl tracking-tight"
      >
        {t("title")}
      </h2>
      <FaqAccordion entries={entries} />
    </section>
  );
}
