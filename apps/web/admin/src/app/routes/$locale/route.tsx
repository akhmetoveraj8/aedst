import { createFileRoute, Outlet } from "@tanstack/react-router";

import { loadMessages } from "@/app/config/i18n/messages";
import { LocaleProviders } from "@/app/providers/LocaleProviders";
import { LocaleError } from "@/app/shell/LocaleError";
import { LocaleNotFound } from "@/app/shell/LocaleNotFound";
import { SkipLink } from "@/app/shell/SkipLink";
import { getLocaleDirection, toLanguageTag } from "@/shared/i18n/locales";

export const Route = createFileRoute("/$locale")({
  // Only the active locale's catalogues are fetched, once per locale.
  loader: async ({ context }) => {
    const { locale } = context;
    const messages = await loadMessages(locale);
    const root = document.documentElement;
    root.lang = toLanguageTag(locale);
    root.dir = getLocaleDirection(locale);
    return { messages };
  },
  staleTime: Number.POSITIVE_INFINITY,
  gcTime: Number.POSITIVE_INFINITY,
  component: LocaleLayout,
  errorComponent: LocaleError,
  notFoundComponent: LocaleNotFound,
});

function LocaleLayout() {
  const { locale, session } = Route.useRouteContext();
  const { messages } = Route.useLoaderData();
  return (
    <LocaleProviders locale={locale} messages={messages} session={session}>
      <SkipLink />
      <Outlet />
    </LocaleProviders>
  );
}
