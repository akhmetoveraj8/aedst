import type { Metadata } from "next";
import { buildLanguageAlternates, siteConfig } from "@/app/config/seo";
import { defaultLocale, localeNames, locales } from "@/shared/i18n/locales";

// Static, script-free fallback for `/`: a zero-second meta refresh to the
// default locale plus a plain link per language. Crawlers follow the refresh
// like a redirect; `x-default` points at the same default locale.
export const metadata: Metadata = {
  metadataBase: siteConfig.url,
  title: siteConfig.name,
  description: siteConfig.description,
  robots: { index: false, follow: true },
  alternates: {
    canonical: `/${defaultLocale}`,
    languages: buildLanguageAlternates(""),
  },
  other: { refresh: `0;url=/${defaultLocale}` },
};

export default function RootIndexPage() {
  return (
    <main className="flex flex-1 flex-col items-center justify-center gap-6 px-4 py-24 text-center">
      <h1 className="font-semibold text-2xl">{siteConfig.name}</h1>
      <ul className="flex flex-wrap justify-center gap-4">
        {locales.map((locale) => (
          <li key={locale}>
            <a
              href={`/${locale}`}
              hrefLang={locale}
              className="font-medium underline underline-offset-4"
            >
              {localeNames[locale]}
            </a>
          </li>
        ))}
      </ul>
    </main>
  );
}
