import { NuqsAdapter } from "nuqs/adapters/tanstack-router";
import type { ReactNode } from "react";
import { Toaster } from "sonner";
import { IntlProvider } from "use-intl";

import type { Session } from "@/app/auth/session";
import { signInUrl } from "@/app/config/env";
import { QueryProvider } from "@/app/providers/query-provider";
import { ThemeProvider } from "@/app/providers/theme-provider";
import { getLocaleDirection, type Locale } from "@/shared/i18n/locales";
import { AuthProvider } from "@/shared/lib/auth/auth-provider";
import { DirectionProvider } from "@/shared/ui/direction";

/**
 * The provider stack of the signed-in shell, one per locale: i18n, text
 * direction, theme, URL state (nuqs on TanStack Router), auth mirror, and
 * TanStack Query + the Connect transport.
 */
export function LocaleProviders({
  locale,
  messages,
  session,
  children,
}: {
  locale: Locale;
  messages: Record<string, unknown>;
  session: Session | null;
  children: ReactNode;
}) {
  const direction = getLocaleDirection(locale);
  return (
    <IntlProvider locale={locale} messages={messages}>
      <DirectionProvider direction={direction}>
        <ThemeProvider
          attribute="class"
          defaultTheme="system"
          enableSystem
          disableTransitionOnChange
        >
          <NuqsAdapter>
            <AuthProvider
              initialUserId={session ? (session.sub ?? "operator") : null}
              initialRoles={session?.roles}
            >
              <QueryProvider signInUrl={signInUrl(`/${locale}/admin`)}>
                {children}
              </QueryProvider>
            </AuthProvider>
          </NuqsAdapter>
          <Toaster richColors dir={direction} />
        </ThemeProvider>
      </DirectionProvider>
    </IntlProvider>
  );
}
