"use client";

import { createContext, type ReactNode, use } from "react";

export type ErrorMessages = {
  title: string;
  description: string;
  tryAgain: string;
};

const ErrorMessagesContext = createContext<ErrorMessages | null>(null);

/**
 * Hands the three strings of the route error boundary (error.tsx) from the
 * server layout to the client. A plain context instead of
 * `NextIntlClientProvider`: the provider puts the next-intl client runtime
 * and its message formatter into every page's first load for three static
 * strings that need no formatting.
 */
export function ErrorMessagesProvider({
  messages,
  children,
}: {
  messages: ErrorMessages;
  children: ReactNode;
}) {
  return (
    <ErrorMessagesContext value={messages}>{children}</ErrorMessagesContext>
  );
}

export function useErrorMessages(): ErrorMessages | null {
  return use(ErrorMessagesContext);
}
