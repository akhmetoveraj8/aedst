import { getTranslations } from "next-intl/server";
import type { Locale } from "@/shared/i18n/locales";
import { buttonVariants } from "@/shared/ui/button";
import { registerUrl } from "../lib/app-links";

export async function CtaSection({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "marketing.cta" });

  return (
    <section
      aria-labelledby="cta-title"
      className="mx-auto my-16 flex w-full max-w-4xl flex-col items-center gap-4 rounded-4xl bg-muted px-6 py-14 text-center"
    >
      <h2 id="cta-title" className="font-semibold text-3xl tracking-tight">
        {t("title")}
      </h2>
      <p className="max-w-xl text-muted-foreground">{t("subtitle")}</p>
      <a href={registerUrl()} className={buttonVariants({ size: "lg" })}>
        {t("button")}
      </a>
    </section>
  );
}
