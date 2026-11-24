import { getTranslations } from "next-intl/server";
import type { Locale } from "@/shared/i18n/locales";
import { buttonVariants } from "@/shared/ui/button";
import { registerUrl } from "../lib/app-links";

export async function Hero({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "marketing.hero" });

  return (
    <section
      aria-labelledby="hero-title"
      className="mx-auto flex w-full max-w-4xl flex-col items-center gap-6 px-4 py-20 text-center sm:py-28"
    >
      <p className="rounded-full border px-3 py-1 text-sm text-muted-foreground">
        {t("eyebrow")}
      </p>
      <h1
        id="hero-title"
        className="text-balance font-semibold text-4xl tracking-tight sm:text-6xl"
      >
        {t("title")}
      </h1>
      <p className="max-w-2xl text-balance text-lg text-muted-foreground">
        {t("subtitle")}
      </p>
      <div className="flex flex-wrap items-center justify-center gap-3">
        <a href={registerUrl()} className={buttonVariants({ size: "lg" })}>
          {t("primary")}
        </a>
        <a
          href="#how-it-works"
          className={buttonVariants({ size: "lg", variant: "outline" })}
        >
          {t("secondary")}
        </a>
      </div>
    </section>
  );
}
