import type { Metadata } from "next";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { fontArabic, fontSans } from "@/app/config/fonts";
import { appIcons } from "@/app/config/icons";
import { JsonLd } from "@/app/config/json-ld";
import { buildVerification, siteConfig } from "@/app/config/seo";
import { graph, organization, webSite } from "@/app/config/structured-data";
import { ErrorMessagesProvider } from "@/app/providers/error-messages";
import { ThemeScript } from "@/app/providers/theme-script";
import { SiteFooter } from "@/modules/marketing/entries/site-footer";
import { SiteHeader } from "@/modules/marketing/entries/site-header";
import { getLocaleDirection, toLanguageTag } from "@/shared/i18n/locales";
import { requireLocale } from "@/shared/i18n/require-locale";
import { routing } from "@/shared/i18n/routing";

import "@app/styles/globals.css";

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "common" });

  return {
    metadataBase: siteConfig.url,
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    description: t("appDescription"),
    applicationName: t("appName"),
    verification: buildVerification(),
    icons: appIcons,
    robots: {
      index: true,
      follow: true,
      googleBot: { index: true, follow: true },
    },
    openGraph: {
      type: "website",
      siteName: t("appName"),
      title: t("appName"),
      description: t("appDescription"),
      locale: toLanguageTag(locale),
      url: `/${locale}`,
    },
    twitter: {
      card: "summary_large_image",
      title: t("appName"),
      description: t("appDescription"),
    },
  };
}

export function generateStaticParams() {
  return routing.locales.map((locale) => ({ locale }));
}

export default async function RootLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const locale = requireLocale((await params).locale);
  setRequestLocale(locale);

  const t = await getTranslations({ locale, namespace: "common" });
  const direction = getLocaleDirection(locale);
  // The only strings a client component needs: the error boundary (error.tsx).
  const errorMessages = {
    title: t("errors.title"),
    description: t("errors.generic"),
    tryAgain: t("actions.tryAgain"),
  };

  // No headers()/cookies() here: reading request data would make every page
  // dynamic. The site is fully static (see next.config.ts for the CSP).
  return (
    <html
      lang={toLanguageTag(locale)}
      dir={direction}
      className={`${fontSans.variable} ${fontArabic.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeScript />
        <JsonLd
          data={graph(
            organization(),
            webSite({ inLanguage: toLanguageTag(locale) }),
          )}
        />
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:font-medium focus:text-foreground"
        >
          {t("a11y.skipToContent")}
        </a>
        <SiteHeader locale={locale} />
        <main id="main-content" className="flex-1">
          {/* Client islands get their strings as props or through this context. */}
          <ErrorMessagesProvider messages={errorMessages}>
            {children}
          </ErrorMessagesProvider>
        </main>
        <SiteFooter locale={locale} />
      </body>
    </html>
  );
}
