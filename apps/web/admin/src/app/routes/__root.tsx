import { createRootRoute, Outlet, redirect } from "@tanstack/react-router";

import { goToSignIn } from "@/app/auth/guards";
import { loadSession } from "@/app/auth/session";
import { negotiateLocale, splitLocale } from "@/app/i18n/locale-path";
import { RootError } from "@/app/shell/RootError";
import { RootNotFound } from "@/app/shell/RootNotFound";

export const Route = createRootRoute({
  // Runs on every navigation, but the session is probed once (cached), so
  // there is no per-page waterfall.
  beforeLoad: async ({ location }) => {
    const parts = splitLocale(location.pathname);
    if (!parts) {
      // `/` and paths without a known locale prefix: negotiate a locale.
      const locale = negotiateLocale();
      throw redirect({
        href:
          location.pathname === "/"
            ? `/${locale}/admin`
            : `/${locale}${location.href}`,
        replace: true,
      });
    }
    const session = await loadSession();
    // `/forbidden` is public: the BFF sends failed sign-ins there.
    if (!session && parts.rest !== "/forbidden") {
      return goToSignIn(location.href);
    }
    return { session, locale: parts.locale };
  },
  component: Outlet,
  errorComponent: RootError,
  notFoundComponent: RootNotFound,
});
