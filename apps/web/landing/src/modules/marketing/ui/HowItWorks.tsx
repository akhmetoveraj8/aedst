import { getTranslations } from "next-intl/server";
import type { Locale } from "@/shared/i18n/locales";
import { stepKeys } from "../lib/content-keys";

export async function HowItWorks({ locale }: { locale: Locale }) {
  const t = await getTranslations({
    locale,
    namespace: "marketing.howItWorks",
  });

  return (
    <section
      id="how-it-works"
      aria-labelledby="how-title"
      className="mx-auto w-full max-w-5xl scroll-mt-20 px-4 py-16"
    >
      <h2
        id="how-title"
        className="mb-10 text-center font-semibold text-3xl tracking-tight"
      >
        {t("title")}
      </h2>
      <ol className="grid gap-8 md:grid-cols-3">
        {stepKeys.map((key, index) => (
          <li key={key} className="flex flex-col gap-2">
            <span
              aria-hidden="true"
              className="flex size-9 items-center justify-center rounded-full bg-primary font-semibold text-primary-foreground"
            >
              {index + 1}
            </span>
            <h3 className="font-medium text-lg">{t(`steps.${key}.title`)}</h3>
            <p className="text-muted-foreground">
              {t(`steps.${key}.description`)}
            </p>
          </li>
        ))}
      </ol>
    </section>
  );
}
