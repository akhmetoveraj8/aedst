import { getTranslations } from "next-intl/server";
import type { Locale } from "@/shared/i18n/locales";
import { Badge } from "@/shared/ui/badge";
import { buttonVariants } from "@/shared/ui/button";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { registerUrl } from "../lib/app-links";
import { tierKeys } from "../lib/content-keys";

const featuredTier = "pro";

/** Placeholder tiers: names, prices and limits are not final (see `pricing.note`). */
export async function Pricing({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "marketing.pricing" });

  return (
    <section
      id="pricing"
      aria-labelledby="pricing-title"
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16"
    >
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <h2
          id="pricing-title"
          className="font-semibold text-3xl tracking-tight"
        >
          {t("title")}
        </h2>
        <p className="mt-3 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ul className="grid gap-4 md:grid-cols-3">
        {tierKeys.map((key) => (
          <li key={key}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle className="flex items-center justify-between gap-2">
                  {t(`tiers.${key}.name`)}
                  {key === featuredTier ? <Badge>{t("popular")}</Badge> : null}
                </CardTitle>
                <p className="font-semibold text-3xl">
                  {t(`tiers.${key}.price`)}
                </p>
                <CardDescription>
                  {t(`tiers.${key}.description`)}
                </CardDescription>
                <ul className="mt-2 flex list-disc flex-col gap-1 ps-5 text-sm">
                  <li>{t(`tiers.${key}.f1`)}</li>
                  <li>{t(`tiers.${key}.f2`)}</li>
                  <li>{t(`tiers.${key}.f3`)}</li>
                </ul>
                <a
                  href={registerUrl()}
                  className={buttonVariants({
                    variant: key === featuredTier ? "default" : "outline",
                    className: "mt-4",
                  })}
                >
                  {t(`tiers.${key}.cta`)}
                </a>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
      <p className="mt-6 text-center text-sm text-muted-foreground">
        {t("note")}
      </p>
    </section>
  );
}
