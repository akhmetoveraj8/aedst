import type { ReactNode } from "react";
import { fontSans } from "@/app/config/fonts";
import { ThemeScript } from "@/app/providers/theme-script";
import { defaultLocale, toLanguageTag } from "@/shared/i18n/locales";

import "@app/styles/globals.css";

/**
 * Second root layout, for the site root `/` only. A static export has no
 * proxy, so the locale-less URL cannot be redirected by next-intl; the static
 * host negotiates the locale from `Accept-Language` (`deployments/nginx`) and
 * this page is the fallback for hosts that cannot (and for crawlers).
 */
export default function RootIndexLayout({ children }: { children: ReactNode }) {
  return (
    <html
      lang={toLanguageTag(defaultLocale)}
      className={`${fontSans.variable} h-full antialiased`}
      suppressHydrationWarning
    >
      <body className="flex min-h-full flex-col">
        <ThemeScript />
        {children}
      </body>
    </html>
  );
}
