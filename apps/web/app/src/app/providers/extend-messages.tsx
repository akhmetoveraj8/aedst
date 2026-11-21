"use client";

import { NextIntlClientProvider, useLocale, useMessages } from "next-intl";
import type { ReactNode } from "react";

/**
 * Adds `messages` to the catalogs the parent provider already sent, so a
 * route segment ships only its own module's strings on top of what the layout
 * above provides (see `RouteMessages.tsx`).
 */
export function ExtendMessages({
  messages,
  children,
}: {
  messages: Record<string, unknown>;
  children: ReactNode;
}) {
  const parent = useMessages();
  const locale = useLocale();
  return (
    <NextIntlClientProvider
      locale={locale}
      messages={{ ...parent, ...messages }}
    >
      {children}
    </NextIntlClientProvider>
  );
}
