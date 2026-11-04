import type { Metadata } from "next";
import { cookies, headers } from "next/headers";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";
import { requireLocale } from "@/shared/i18n/require-locale";

import "@app/styles/globals.css";
import { fontArabic, fontMono, fontSans } from "@/app/config/fonts";
import { loadMessages } from "@/app/config/i18n/messages";
import { appIcons } from "@/app/config/icons";
import { JsonLd } from "@/app/config/JsonLd";
import { publicI18nNamespaces } from "@/app/config/modules/registry";
import { buildVerification, siteConfig } from "@/app/config/seo";
import { graph, organization, webSite } from "@/app/config/structured-data";
import { AppOutboxProvider } from "@/app/providers/AppOutboxProvider";
import { ConsentLayer } from "@/app/providers/ConsentLayer";
import { PwaProvider } from "@/app/providers/PwaProvider";
import { QueryProvider } from "@/app/providers/QueryProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { WebVitals } from "@/app/providers/WebVitals";
import { OfflineBanner } from "@/app/shell/OfflineBanner";
import { getLocaleDirection, toLanguageTag } from "@/shared/i18n/locales";
import { routing } from "@/shared/i18n/routing";
import { AuthProvider } from "@/shared/lib/auth/AuthProvider";
import { getSessionRoles, getSessionUserId } from "@/shared/lib/auth/session";
import { ConsentProvider } from "@/shared/lib/consent/ConsentProvider";
import {
  CONSENT_COOKIE,
  isGlobalPrivacyControl,
  parseConsent,
} from "@/shared/lib/consent/consent-cookie";
import { DirectionProvider } from "@/shared/ui/direction";

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "common" });

  return {
    metadataBase: siteConfig.url,
    title: {
      default: t("appName"),
      template: `%s · ${t("appName")}`,
    },
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
  const { locale } = await params;

  if (!hasLocale(routing.locales, locale)) {
    notFound();
  }

  setRequestLocale(locale);

  const direction = getLocaleDirection(locale);
  const t = await getTranslations({ locale, namespace: "common" });
  // Reading request data is what opts the tree into dynamic rendering, which
  // the per-request CSP nonce (set by proxy.ts) requires. The nonce is
  // handed to next-themes' inline no-flash script so the strict CSP allows it.
  const requestHeaders = await headers();
  const nonce = requestHeaders.get("x-nonce") ?? undefined;
  const privacySignal = isGlobalPrivacyControl(requestHeaders);
  const userId = (await getSessionUserId()) ?? null;
  const roles = await getSessionRoles();
  const consent = parseConsent((await cookies()).get(CONSENT_COOKIE)?.value);

  return (
    <html
      lang={toLanguageTag(locale)}
      dir={direction}
      className={`${fontSans.variable} ${fontArabic.variable} ${fontMono.variable} h-full antialiased`}
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
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:font-medium focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-ring"
        >
          {t("a11y.skipToContent")}
        </a>

        <NextIntlClientProvider
          messages={await loadMessages(locale, publicI18nNamespaces)}
        >
          <DirectionProvider direction={direction}>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
              nonce={nonce}
            >
              <ConsentProvider initial={consent} privacySignal={privacySignal}>
                <PwaProvider>
                  <OfflineBanner />
                  <NuqsAdapter>
                    <AuthProvider initialUserId={userId} initialRoles={roles}>
                      <QueryProvider>
                        <AppOutboxProvider>{children}</AppOutboxProvider>
                      </QueryProvider>
                    </AuthProvider>
                  </NuqsAdapter>
                </PwaProvider>

                <Toaster
                  richColors
                  dir={direction}
                  containerAriaLabel={t("a11y.notifications")}
                />
                <WebVitals />
                <ConsentLayer />
              </ConsentProvider>
            </ThemeProvider>
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
