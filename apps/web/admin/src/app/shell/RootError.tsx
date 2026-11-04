import type { ErrorComponentProps } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import {
  fallbackMessages,
  pickFallbackLocale,
} from "@/app/config/i18n/fallback-messages";
import { getLocaleDirection, toLanguageTag } from "@/shared/i18n/locales";
import { reportError } from "@/shared/lib/errors/report-error";

/**
 * The final fallback: errors thrown outside the locale layout (a failed
 * session probe, a broken provider). Nothing above it can be trusted, so it
 * uses the provider-free `fallbackMessages` and picks the locale itself.
 */
export function RootError({ error }: ErrorComponentProps) {
  const [locale] = useState(() =>
    pickFallbackLocale({
      pathname: window.location.pathname,
      languages: navigator.languages,
    }),
  );
  const messages = fallbackMessages[locale];

  useEffect(() => {
    reportError(error, { source: "route" });
  }, [error]);

  useEffect(() => {
    document.documentElement.lang = toLanguageTag(locale);
    document.documentElement.dir = getLocaleDirection(locale);
  }, [locale]);

  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center font-sans"
    >
      <title>{messages.errorTitle}</title>
      <p className="font-medium text-muted-foreground text-sm">
        {messages.errorLabel}
      </p>
      <h1 className="font-semibold text-2xl text-foreground">
        {messages.errorTitle}
      </h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {messages.errorDescription}
      </p>
      <a
        href="/"
        className="font-medium text-foreground text-sm underline underline-offset-4"
      >
        {messages.goHome}
      </a>
    </main>
  );
}
