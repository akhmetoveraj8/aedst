import { getTranslations } from "next-intl/server";
import type { Locale } from "@/shared/i18n/locales";
import { Card, CardDescription, CardHeader, CardTitle } from "@/shared/ui/card";
import { featureKeys } from "../lib/content-keys";

export async function Features({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "marketing.features" });

  return (
    <section
      id="features"
      aria-labelledby="features-title"
      className="mx-auto w-full max-w-6xl scroll-mt-20 px-4 py-16"
    >
      <div className="mx-auto mb-10 max-w-2xl text-center">
        <h2
          id="features-title"
          className="font-semibold text-3xl tracking-tight"
        >
          {t("title")}
        </h2>
        <p className="mt-3 text-muted-foreground">{t("subtitle")}</p>
      </div>
      <ul className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
        {featureKeys.map((key) => (
          <li key={key}>
            <Card className="h-full">
              <CardHeader>
                <CardTitle>{t(`items.${key}.title`)}</CardTitle>
                <CardDescription>
                  {t(`items.${key}.description`)}
                </CardDescription>
              </CardHeader>
            </Card>
          </li>
        ))}
      </ul>
    </section>
  );
}
