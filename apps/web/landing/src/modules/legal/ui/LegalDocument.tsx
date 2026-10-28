import { getTranslations } from "next-intl/server";
import type { Locale } from "@/shared/i18n/locales";
import { legalSectionKeys } from "../lib/section-keys";

type LegalDocumentProps = {
  locale: Locale;
  /** Namespace under `legal.*`: "privacy" or "terms". */
  document: "privacy" | "terms";
};

/** Renders a legal page from `legal.<document>.*`. The copy is a template, see `notice`. */
export async function LegalDocument({ locale, document }: LegalDocumentProps) {
  const t = await getTranslations({
    locale,
    namespace: `legal.${document}`,
  });

  return (
    <article className="mx-auto w-full max-w-3xl px-4 py-16">
      <h1 className="font-semibold text-4xl tracking-tight">{t("title")}</h1>
      <p className="mt-2 text-sm text-muted-foreground">{t("updated")}</p>
      <p className="mt-6 rounded-lg border bg-muted px-4 py-3 text-sm">
        {t("notice")}
      </p>
      <p className="mt-6">{t("intro")}</p>
      {legalSectionKeys.map((key) => (
        <section key={key} className="mt-8">
          <h2 className="font-semibold text-xl">
            {t(`sections.${key}.title`)}
          </h2>
          <p className="mt-2 text-muted-foreground">
            {t(`sections.${key}.body`)}
          </p>
        </section>
      ))}
    </article>
  );
}
