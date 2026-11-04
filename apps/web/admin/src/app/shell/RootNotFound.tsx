import { useState } from "react";

import {
  fallbackMessages,
  pickFallbackLocale,
} from "@/app/config/i18n/fallback-messages";

/** Provider-free 404 for URLs the locale layout never handled. */
export function RootNotFound() {
  const [locale] = useState(() =>
    pickFallbackLocale({
      pathname: window.location.pathname,
      languages: navigator.languages,
    }),
  );
  const messages = fallbackMessages[locale];

  return (
    <main
      id="main-content"
      className="flex min-h-screen flex-col items-center justify-center gap-4 px-4 text-center font-sans"
    >
      <title>{messages.notFoundTitle}</title>
      <p className="font-medium text-muted-foreground text-sm">404</p>
      <h1 className="font-semibold text-2xl text-foreground">
        {messages.notFoundTitle}
      </h1>
      <p className="max-w-md text-muted-foreground text-sm">
        {messages.notFoundDescription}
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
