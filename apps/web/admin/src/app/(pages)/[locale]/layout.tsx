import type { Metadata } from "next";
import { headers } from "next/headers";
import { notFound } from "next/navigation";
import { hasLocale, NextIntlClientProvider } from "next-intl";
import { getTranslations, setRequestLocale } from "next-intl/server";
import { NuqsAdapter } from "nuqs/adapters/next/app";
import { Toaster } from "sonner";

import "@app/styles/globals.css";
import { signInUrl } from "@/app/config/env";
import { fontArabic, fontMono, fontSans } from "@/app/config/fonts";
import { loadMessages } from "@/app/config/i18n/messages";
import { QueryProvider } from "@/app/providers/QueryProvider";
import { ThemeProvider } from "@/app/providers/ThemeProvider";
import { getLocaleDirection, toLanguageTag } from "@/shared/i18n/locales";
import { requireLocale } from "@/shared/i18n/require-locale";
import { routing } from "@/shared/i18n/routing";
import { AuthProvider } from "@/shared/lib/auth/AuthProvider";
import { getSessionRoles, getSessionUserId } from "@/shared/lib/auth/session";
import { DirectionProvider } from "@/shared/ui/direction";

export async function generateMetadata({
  params,
}: LayoutProps<"/[locale]">): Promise<Metadata> {
  const locale = requireLocale((await params).locale);
  const t = await getTranslations({ locale, namespace: "common" });

  return {
    title: { default: t("appName"), template: `%s · ${t("appName")}` },
    description: t("appDescription"),
    applicationName: t("appName"),
    // The admin panel is never indexed (also sent as X-Robots-Tag by proxy.ts
    // and disallowed in robots.txt).
    robots: { index: false, follow: false },
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
  // Reading request data opts the tree into dynamic rendering, which the
  // per-request CSP nonce (set by proxy.ts) requires. The nonce goes to
  // next-themes' inline no-flash script so the strict CSP allows it.
  const nonce = (await headers()).get("x-nonce") ?? undefined;
  const userId = (await getSessionUserId()) ?? null;
  const roles = await getSessionRoles();

  return (
    <html
      lang={toLanguageTag(locale)}
      dir={direction}
      className={`${fontSans.variable} ${fontArabic.variable} ${fontMono.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <a
          href="#main-content"
          className="sr-only focus:not-sr-only focus:fixed focus:start-4 focus:top-4 focus:z-50 focus:rounded-md focus:bg-background focus:px-4 focus:py-2 focus:font-medium focus:text-foreground focus:shadow-lg focus:ring-2 focus:ring-ring"
        >
          {t("a11y.skipToContent")}
        </a>

        <NextIntlClientProvider messages={await loadMessages(locale)}>
          <DirectionProvider direction={direction}>
            <ThemeProvider
              attribute="class"
              defaultTheme="system"
              enableSystem
              disableTransitionOnChange
              nonce={nonce}
            >
              <NuqsAdapter>
                <AuthProvider initialUserId={userId} initialRoles={roles}>
                  <QueryProvider signInUrl={signInUrl(`/${locale}/admin`)}>
                    {children}
                  </QueryProvider>
                </AuthProvider>
              </NuqsAdapter>
              <Toaster richColors dir={direction} />
            </ThemeProvider>
          </DirectionProvider>
        </NextIntlClientProvider>
      </body>
    </html>
  );
}
