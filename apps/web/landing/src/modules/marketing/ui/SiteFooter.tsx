import { getTranslations } from "next-intl/server";
import type { Locale } from "@/shared/i18n/locales";
import { Link } from "@/shared/i18n/navigation";

export async function SiteFooter({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "common" });

  return (
    <footer className="mt-auto border-t">
      <div className="mx-auto flex max-w-6xl flex-col gap-4 px-4 py-8 text-sm text-muted-foreground sm:flex-row sm:items-center sm:justify-between">
        <div>
          <p className="font-medium text-foreground">{t("appName")}</p>
          <p>{t("footer.tagline")}</p>
        </div>
        <nav aria-label={t("footer.legal")}>
          <ul className="flex gap-5">
            <li>
              <Link href="/privacy" className="hover:text-foreground">
                {t("footer.privacy")}
              </Link>
            </li>
            <li>
              <Link href="/terms" className="hover:text-foreground">
                {t("footer.terms")}
              </Link>
            </li>
          </ul>
        </nav>
        <p>{t("footer.rights", { year: new Date().getFullYear() })}</p>
      </div>
    </footer>
  );
}
