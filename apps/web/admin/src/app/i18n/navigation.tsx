import {
  Link as RouterLink,
  redirect as routerRedirect,
  useLocation,
  useRouter as useRouterInstance,
} from "@tanstack/react-router";
import { type ComponentProps, useMemo } from "react";
import { useLocale } from "use-intl";

import { clearSession } from "@/app/auth/session";
import { type Locale, locales } from "@/shared/i18n/locales";

/**
 * Admin-local replacement for `@/shared/i18n/navigation` (next-intl's
 * `createNavigation` in the Next projects), selected by a Vite/tsconfig alias
 * in this project only. Same exports and semantics: hrefs are locale-less
 * (`/admin/tasks`), the `/{locale}` prefix is added from the active locale (or
 * the `locale` option), and `usePathname` returns the locale-less path.
 */

type NavigateOptions = { locale?: Locale };

/** `/admin` + `ru` -> `/ru/admin`. */
function localize(href: string, locale: Locale): string {
  return href === "/" ? `/${locale}` : `/${locale}${href}`;
}

function stripLocale(pathname: string): string {
  const [, first, ...rest] = pathname.split("/");
  if (locales.some((locale) => locale === first)) {
    return `/${rest.join("/")}`;
  }
  return pathname;
}

type LinkProps = Omit<ComponentProps<"a">, "href"> & {
  href: string;
  locale?: Locale;
};

export function Link({ href, locale, ...props }: LinkProps) {
  const active = useLocale();
  const target = new URL(localize(href, locale ?? active), "http://local");
  return (
    <RouterLink
      to={target.pathname as never}
      search={
        target.search
          ? (Object.fromEntries(target.searchParams) as never)
          : undefined
      }
      {...props}
    />
  );
}

export function usePathname(): string {
  return stripLocale(useLocation({ select: (location) => location.pathname }));
}

export function useRouter() {
  const router = useRouterInstance();
  const active = useLocale();
  return useMemo(
    () => ({
      push: (href: string, options?: NavigateOptions) =>
        router.history.push(localize(href, options?.locale ?? active)),
      replace: (href: string, options?: NavigateOptions) =>
        router.history.replace(localize(href, options?.locale ?? active)),
      back: () => router.history.back(),
      /** Re-runs the route loaders, including the session probe. */
      refresh: () => {
        clearSession();
        void router.invalidate();
      },
      prefetch: (href: string, options?: NavigateOptions) => {
        const target = new URL(
          localize(href, options?.locale ?? active),
          "http://local",
        );
        void router.preloadRoute({
          to: target.pathname as never,
          search: Object.fromEntries(target.searchParams) as never,
        });
      },
    }),
    [router, active],
  );
}

/** Throws a router redirect; call it from `beforeLoad`/`loader`. */
export function redirect({
  href,
  locale,
}: {
  href: string;
  locale: Locale;
}): never {
  throw routerRedirect({ href: localize(href, locale) });
}

export function getPathname({
  href,
  locale,
}: {
  href: string;
  locale: Locale;
}): string {
  return localize(href, locale);
}
