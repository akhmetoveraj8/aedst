import { moduleRoutes } from "@/app/config/modules/registry";
import { type Locale, locales } from "@/shared/i18n/locales";
import { safeRedirectPath } from "@/shared/lib/auth/safe-redirect";
import { isAccessTokenExpired } from "@/shared/lib/auth/session-claims";

/**
 * Locale-less path prefixes that require a signed-in user, and the ones that
 * additionally require a role (UX only — the server enforces it). Both come
 * from the module manifests (`routes`) through the registry, not from a
 * list kept here.
 */
const PROTECTED_PREFIXES = moduleRoutes
  .filter((route) => route.access === "session")
  .map((route) => route.path);

const ROLE_PREFIXES: ReadonlyArray<{ prefix: string; role: string }> =
  moduleRoutes.flatMap((route) =>
    route.access === "session" && route.requiredRole
      ? [{ prefix: route.path, role: route.requiredRole }]
      : [],
  );

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

function matchesPrefix(rest: string, prefix: string): boolean {
  return rest === prefix || rest.startsWith(`${prefix}/`);
}

function isProtected(rest: string): boolean {
  return PROTECTED_PREFIXES.some((prefix) => matchesPrefix(rest, prefix));
}

function requiredRole(rest: string): string | undefined {
  return ROLE_PREFIXES.find(({ prefix }) => matchesPrefix(rest, prefix))?.role;
}

export type RouteDecision =
  | { type: "next" }
  | { type: "redirect"; location: string };

/**
 * Where a request should go given its session — pure so the auth rules are
 * unit-testable without a running proxy:
 * - a protected page without a session goes to the login page, remembering
 *   the destination in `?next=` so sign-in lands back on it;
 * - a page of a module the server has switched off goes to the forbidden page;
 * - a role-gated page for a signed-in user without that role goes to the
 *   forbidden page (the server would refuse every call on it anyway);
 * - the login page with a session skips straight to that destination.
 */
export function decideRoute({
  pathname,
  search,
  session,
  roles = [],
  disabledPrefixes = [],
}: {
  pathname: string;
  search: string;
  session: SessionState;
  /** Unverified roles of the active session. */
  roles?: readonly string[];
  /** Route prefixes of modules the server has switched off (capabilities). */
  disabledPrefixes?: readonly string[];
}): RouteDecision {
  const parts = splitLocale(pathname);
  if (!parts) {
    return { type: "next" };
  }
  const { locale, rest } = parts;

  if (isProtected(rest) && session === "anonymous") {
    const next = encodeURIComponent(`${rest}${search}`);
    return { type: "redirect", location: `/${locale}?next=${next}` };
  }

  if (disabledPrefixes.some((prefix) => matchesPrefix(rest, prefix))) {
    return { type: "redirect", location: `/${locale}/forbidden` };
  }

  const role = requiredRole(rest);
  // Also while the session is only refreshable (IdP unavailable): the roles of the
  // stale access token still say who may not enter, so this fails closed.
  if (role && session !== "anonymous" && !roles.includes(role)) {
    return { type: "redirect", location: `/${locale}/forbidden` };
  }

  if ((rest === "" || rest === "/") && session !== "anonymous") {
    const requested = new URLSearchParams(search).get("next");
    return {
      type: "redirect",
      location: `/${locale}${safeRedirectPath(requested)}`,
    };
  }

  return { type: "next" };
}
