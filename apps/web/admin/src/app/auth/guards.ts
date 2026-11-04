import { redirect } from "@tanstack/react-router";

import { signInUrl } from "@/app/config/env";
import type { Locale } from "@/shared/i18n/locales";
import { type AdminPermission, can, isOperator } from "@/shared/lib/auth/roles";

/**
 * Cosmetic route guards (UX only): the BFF guards the HTML and apps/server's
 * RoleInterceptor guards every RPC.
 */

/** Anonymous visitors restart the BFF's OIDC login (a full-page navigation). */
export function goToSignIn(returnTo: string): Promise<never> {
  window.location.assign(signInUrl(returnTo));
  // The page is being replaced: keep the router from rendering anything meanwhile.
  return new Promise<never>(() => {});
}

/** A signed-in user without an operator role belongs on the forbidden page. */
export function assertOperator(roles: readonly string[], locale: Locale): void {
  if (!isOperator(roles)) {
    throw redirect({ href: `/${locale}/forbidden` });
  }
}

/** Page-level permission gate. */
export function assertPermission(
  roles: readonly string[],
  locale: Locale,
  permission: AdminPermission,
): void {
  if (!can(roles, permission)) {
    throw redirect({ href: `/${locale}/forbidden` });
  }
}
