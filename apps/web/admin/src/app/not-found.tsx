import { headers } from "next/headers";

import {
  fallbackMessages,
  pickFallbackLocale,
} from "@/app/config/i18n/fallback-messages";
import { getLocaleDirection } from "@/shared/i18n/locales";

// Renders for URLs outside any locale segment, where next-intl is not
// available, so it localizes from the request's Accept-Language itself.
export default async function RootNotFound() {
  const locale = pickFallbackLocale({
    languages: (await headers()).get("accept-language"),
  });
  const messages = fallbackMessages[locale];

  return (
    <html lang={locale} dir={getLocaleDirection(locale)}>
      <head>
        <title>{messages.notFoundTitle}</title>
      </head>
      <body className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center font-sans">
        <p className="text-sm font-medium text-muted-foreground">404</p>
        <h1 className="text-2xl font-semibold text-foreground">
          {messages.notFoundTitle}
        </h1>
        <p className="max-w-md text-sm text-muted-foreground">
          {messages.notFoundDescription}
        </p>
        <a
          href="/"
          className="text-sm font-medium text-foreground underline underline-offset-4"
        >
          {messages.goHome}
        </a>
      </body>
    </html>
  );
}
