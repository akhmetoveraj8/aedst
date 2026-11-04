import { getTranslations } from "next-intl/server";
import type { Locale } from "@/shared/i18n/locales";
import { Link } from "@/shared/i18n/navigation";
import { buttonVariants } from "@/shared/ui/button";
import { signInUrl } from "../lib/app-links";
import { LocaleSwitcher } from "./LocaleSwitcher";

const navItems = [
  ["features", "#features"],
  ["howItWorks", "#how-it-works"],
  ["pricing", "#pricing"],
  ["faq", "#faq"],
] as const;

export async function SiteHeader({ locale }: { locale: Locale }) {
  const t = await getTranslations({ locale, namespace: "common" });

  return (
    <header className="sticky top-0 z-40 border-b bg-background/90 backdrop-blur">
      <div className="mx-auto flex h-14 max-w-6xl items-center gap-4 px-4">
        <Link href="/" className="font-semibold text-lg tracking-tight">
          {t("appName")}
        </Link>
        <nav aria-label={t("a11y.mainNav")} className="hidden md:block">
          <ul className="flex items-center gap-5 text-sm">
            {navItems.map(([key, hash]) => (
              <li key={key}>
                <Link
                  href={`/${hash}`}
                  className="text-muted-foreground hover:text-foreground"
                >
                  {t(`nav.${key}`)}
                </Link>
              </li>
            ))}
          </ul>
        </nav>
        <div className="ms-auto flex items-center gap-2">
          <LocaleSwitcher label={t("a11y.language")} />
          <a
            href={signInUrl(locale)}
            className={buttonVariants({ variant: "outline", size: "sm" })}
          >
            {t("actions.signIn")}
          </a>
        </div>
      </div>
    </header>
  );
}
