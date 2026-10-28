import { signInUrl } from "@/app/config/env";
import { type Locale, locales } from "@/shared/i18n/locales";
import { ADMIN_ROLE } from "@/shared/lib/auth/roles";
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

export type RouteDecision =
  | { type: "next" }
  | { type: "redirect"; location: string };

/**
 * Where an admin request should go given its session. Pure so the rules are
 * unit-testable without a running proxy. Every page is admin-only except the
 * `/forbidden` page itself:
 * - no session -> this project's own OIDC login (`/api/auth/login?next=`);
 *   admin is a separate OIDC client with its own session cookies and never
 *   reads the app project's session;
 * - a session without the admin role -> `/<locale>/forbidden` (UX only,
 *   apps/server's RoleInterceptor rejects every AdminService call anyway).
 * A "refreshable" session keeps its stale token's roles, so this fails closed
 * while the IdP is unavailable.
 */
export function decideRoute({
  pathname,
  session,
  roles = [],
}: {
  pathname: string;
  session: SessionState;
  /** Unverified roles of the active session. */
  roles?: readonly string[];
}): RouteDecision {
  const parts = splitLocale(pathname);
  if (!parts) {
    return { type: "next" };
  }
  const { locale, rest } = parts;

  if (rest === "/forbidden") {
    return { type: "next" };
  }
  if (session === "anonymous") {
    return { type: "redirect", location: signInUrl(pathname) };
  }
  if (!roles.includes(ADMIN_ROLE)) {
    return { type: "redirect", location: `/${locale}/forbidden` };
  }
  return { type: "next" };
}
