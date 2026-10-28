import type { Metadata } from "next";
import { NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { fontArabic, fontSans } from "@/app/config/fonts";
import { loadMessages } from "@/app/config/i18n/messages";
import { appIcons } from "@/app/config/icons";
import { JsonLd } from "@/app/config/JsonLd";
import { buildVerification, siteConfig } from "@/app/config/seo";
import { graph, organization, webSite } from "@/app/config/structured-data";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { SiteFooter } from "@/modules/marketing/ui/SiteFooter";
import { SiteHeader } from "@/modules/marketing/ui/SiteHeader";
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
  // Only the strings the client error boundary (error.tsx) needs.
  const { common } = await loadMessages(locale);
  const clientMessages = {
    common: {
      errors: common.errors,
      actions: { tryAgain: common.actions.tryAgain },
    },
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
        {/* Client islands get their strings as props; only error.tsx reads messages. */}
        <NextIntlClientProvider messages={clientMessages}>
          <ThemeProvider
            attribute="class"
            defaultTheme="system"
            enableSystem
            disableTransitionOnChange
          >
            <SiteHeader locale={locale} />
            <main id="main-content" className="flex-1">
              {children}
            </main>
            <SiteFooter locale={locale} />
          </ThemeProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
