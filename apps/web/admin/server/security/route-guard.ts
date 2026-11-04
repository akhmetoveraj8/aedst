import { type Locale, locales } from "@/shared/i18n/locales";
import { isOperator } from "@/shared/lib/auth/roles";
import { isAccessTokenExpired } from "@/shared/lib/auth/session-claims";

const LOCALE_PATH = new RegExp(`^/(${locales.join("|")})(/.*)?$`);

export type SessionState =
  /** A usable (unexpired) access token is present. */
  | "active"
  /** No usable access token, but a refresh token could mint one. */
  | "refreshable"
  | "anonymous";

export function classifySession({
  accessToken,
  refreshToken,
  nowMs,
}: {
  accessToken: string | undefined;
  refreshToken: string | undefined;
  nowMs?: number;
}): SessionState {
  if (accessToken && !isAccessTokenExpired(accessToken, nowMs)) {
    return "active";
  }
  return refreshToken ? "refreshable" : "anonymous";
}

export function splitLocale(
  pathname: string,
): { locale: Locale; rest: string } | null {
  const match = LOCALE_PATH.exec(pathname);
  if (!match) {
    return null;
  }
  return { locale: match[1] as Locale, rest: match[2] ?? "" };
}

/** This project's own sign-in entry; `next` is validated again by the login route. */
function signInUrl(next: string): string {
  return `/api/auth/login?next=${encodeURIComponent(next)}`;
}

export type RouteDecision =
  | { type: "next" }
  | { type: "redirect"; location: string };

/**
 * Where an admin document request should go given its session. Pure so the
 * rules are unit-testable without a running server. Every page is admin-only
 * except the `/forbidden` page itself:
 * - no session -> this project's own OIDC login (`/api/auth/login?next=`);
 *   admin is a separate OIDC client with its own session cookies and never
 *   reads the app project's session;
 * - a session without an operator role (admin, support or auditor) ->
 *   `/<locale>/forbidden` (UX only, apps/server's RoleInterceptor rejects every
 *   AdminService call anyway; per-page permissions are checked in the SPA).
 * A path without a locale prefix (`/`, an unknown prefix) is guarded too and
 * goes to the locale-less `/forbidden`; the SPA adds the locale itself.
 * A "refreshable" session keeps its stale token's roles, so an IdP outage does
 * not sign an operator out of the page (UX only: apps/server still enforces
 * the roles on every RPC).
 */
export function decideRoute({
  pathname,
  search = "",
  session,
  roles = [],
}: {
  pathname: string;
  /** Query string including the leading `?`, kept through the sign-in round trip. */
  search?: string;
  session: SessionState;
  /** Unverified roles of the active session. */
  roles?: readonly string[];
}): RouteDecision {
  const parts = splitLocale(pathname);
  const rest = parts ? parts.rest : pathname;

  if (rest === "/forbidden") {
    return { type: "next" };
  }
  if (session === "anonymous") {
    return { type: "redirect", location: signInUrl(`${pathname}${search}`) };
  }
  if (!isOperator(roles)) {
    return {
      type: "redirect",
      location: parts ? `/${parts.locale}/forbidden` : "/forbidden",
    };
  }
  return { type: "next" };
}
