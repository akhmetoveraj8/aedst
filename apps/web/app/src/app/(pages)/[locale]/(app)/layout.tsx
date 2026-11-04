import type { Metadata } from "next";
import { Suspense } from "react";
import { PrivacySettingsButton } from "@/app/providers/PrivacySettingsButton";
import { RouteMessages } from "@/app/providers/RouteMessages";
import { AppNav } from "@/app/shell/AppNav";
import { InstallPrompt } from "@/app/shell/InstallPrompt";
import { LocaleSwitcherLazy } from "@/app/shell/LocaleSwitcherLazy";
import { PageMain } from "@/app/shell/PageMain";
import { SyncStatus } from "@/app/shell/SyncStatus";
import { CurrentUser } from "@/modules/auth/entries/current-user";
import { SignOutButton } from "@/modules/auth/entries/sign-out-button";
import { NotificationBellSection } from "@/modules/notifications/entries/notification-bell-section";
import {
  CommandPalette,
  CommandPaletteTrigger,
} from "@/modules/search/entries/command-palette";
import { requireLocale } from "@/shared/i18n/require-locale";
import { CapabilitiesProvider } from "@/shared/lib/capabilities/CapabilitiesProvider";
import { getServerCapabilities } from "@/shared/lib/capabilities/server";
import { ErrorBoundary } from "@/shared/lib/errors/ErrorBoundary";

/** Routes whose modules own the shell widgets (the sign-in landing `/` ships with every page). */
const SHELL_ROUTES = ["/search", "/notifications"];

// Signed-in pages are per-user and gated by `proxy.ts`; keep them out of
// search indexes explicitly rather than relying on them being empty.
export const metadata: Metadata = { robots: { index: false, follow: false } };

/**
 * The signed-in shell: identity, primary navigation, search (Ctrl/Cmd+K),
 * the notification bell and sign-out — composed here from feature modules,
 * which never import each other. Each widget sits in its own error boundary
 * so a failing bell cannot take the page down.
 */
export default async function AppLayout({
  children,
  params,
}: LayoutProps<"/[locale]">) {
  const locale = requireLocale((await params).locale);
  const capabilities = await getServerCapabilities();

  return (
    // The shell widgets (identity, search, bell) are client components: send
    // their catalogs here; each module segment adds its own on top.
    <RouteMessages locale={locale} routes={SHELL_ROUTES}>
      <CapabilitiesProvider initial={capabilities}>
        <div className="mx-auto flex w-full max-w-5xl flex-1 flex-col gap-6 p-4 sm:p-6">
          <header className="flex flex-col gap-3">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <Suspense fallback={<span />}>
                <CurrentUser />
              </Suspense>
              <div className="flex flex-wrap items-center gap-2">
                <ErrorBoundary feature="search" fallback={null}>
                  <CommandPaletteTrigger />
                  <CommandPalette />
                </ErrorBoundary>
                <ErrorBoundary feature="notifications" fallback={null}>
                  <Suspense fallback={<span className="size-9" />}>
                    <NotificationBellSection />
                  </Suspense>
                </ErrorBoundary>
                <LocaleSwitcherLazy />
                <SignOutButton />
              </div>
            </div>
            <AppNav />
            <SyncStatus />
            <InstallPrompt />
          </header>
          <PageMain>{children}</PageMain>
          <footer className="flex justify-start">
            <PrivacySettingsButton className="text-muted-foreground" />
          </footer>
        </div>
      </CapabilitiesProvider>
    </RouteMessages>
  );
}
