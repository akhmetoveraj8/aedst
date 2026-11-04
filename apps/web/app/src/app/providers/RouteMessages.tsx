import type { ReactNode } from "react";

import { loadMessages } from "@/app/config/i18n/messages";
import { i18nNamespacesForRoutes } from "@/app/config/modules/registry";
import { ExtendMessages } from "@/app/providers/ExtendMessages";
import type { Locale } from "@/shared/i18n/locales";

type RouteMessagesProps = {
  locale: Locale;
  /** Route paths (as in `manifest.routes`) whose module catalogs this subtree needs. */
  routes?: readonly string[];
  /** Module namespaces with no route of their own (e.g. `media`). */
  namespaces?: readonly string[];
  children: ReactNode;
};

/**
 * Sends the client components below only the catalogs of the modules they
 * belong to, on top of the `common` (+ public-route) set the locale layout
 * provides. Without it every page carried every module's strings in its HTML.
 */
export async function RouteMessages({
  locale,
  routes = [],
  namespaces = [],
  children,
}: RouteMessagesProps) {
  const wanted = [...i18nNamespacesForRoutes(routes), ...namespaces];
  const { common: _common, ...modules } = await loadMessages(locale, wanted);
  return <ExtendMessages messages={modules}>{children}</ExtendMessages>;
}
