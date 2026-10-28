"use client";

import { useEffect, useState } from "react";

// The root layout (which normally imports the stylesheet) is what failed, so
// the fallback loads it itself or renders unstyled.
import "@app/styles/globals.css";

import {
  fallbackMessages,
  pickFallbackLocale,
} from "@/app/config/i18n/fallback-messages";
import { defaultLocale, getLocaleDirection } from "@/shared/i18n/locales";
import { reportError } from "@/shared/lib/errors/report-error";

// The final fallback — catches errors the root layout itself throws, which
// `(pages)/[locale]/error.tsx` can't (a segment's error boundary never
// covers its own parent layout). Next.js requires this file to render its
// own complete `<html>`/`<body>`; nothing above it in the tree can be
// trusted to still be working, including next-intl's provider, so it uses
// the provider-free `fallbackMessages` and picks the locale itself.
export default function GlobalError({
  error,
}: {
  error: Error & { digest?: string };
}) {
  const [locale, setLocale] = useState(defaultLocale);

  useEffect(() => {
    reportError(error, {
      source: "route",
      extra: error.digest ? { digest: error.digest } : undefined,
    });
  }, [error]);

  useEffect(() => {
    setLocale(
      pickFallbackLocale({
        pathname: window.location.pathname,
        languages: navigator.languages,
      }),
    );
  }, []);

  const messages = fallbackMessages[locale];

  return (
    <html lang={locale} dir={getLocaleDirection(locale)}>
      <head>
        <title>{messages.errorTitle}</title>
      </head>
      <body>
        <main className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center font-sans">
          <p className="text-sm font-medium text-muted-foreground">
            {messages.errorLabel}
          </p>
          <h1 className="text-2xl font-semibold text-foreground">
            {messages.errorTitle}
          </h1>
          <p className="max-w-md text-sm text-muted-foreground">
            {messages.errorDescription}
          </p>
          <a
            href="/"
            className="text-sm font-medium text-foreground underline underline-offset-4"
          >
            {messages.goHome}
          </a>
        </main>
      </body>
    </html>
  );
}
