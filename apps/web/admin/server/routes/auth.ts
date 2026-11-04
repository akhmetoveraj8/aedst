import { Hono } from "hono";
import { getCookie, setCookie } from "hono/cookie";
import { timeout } from "hono/timeout";

import {
  PRE_AUTH_COOKIE,
  PRE_AUTH_MAX_AGE_SECONDS,
} from "@/shared/lib/auth/oidc/pre-auth-cookie";
import {
  decodeSessionClaims,
  decodeSessionIdentity,
  decodeSessionRoles,
} from "@/shared/lib/auth/session-claims";
import {
  clearSessionCookies,
  ID_COOKIE,
  REFRESH_COOKIE,
  writeSessionCookies,
} from "@/shared/lib/auth/session-cookies";
import { errorFields } from "../logger";
import { cookieJar, resolveSession } from "../session";
import type { AppBindings, AppDeps } from "../types";

const AUTH_TIMEOUT_MS = 30_000;

/**
 * `/api/auth/*`: the admin panel's own OpenID Connect Authorization Code +
 * PKCE flow (a separate OIDC client from the app project; ZITADEL SSO makes
 * the IdP step seamless) and the session probe the SPA uses instead of ever
 * seeing a token. Ported 1:1 from the former Next Route Handlers.
 */
export function authRoutes(deps: AppDeps) {
  const { env, auth, logger } = deps;
  const app = new Hono<AppBindings>();
  app.use("*", timeout(AUTH_TIMEOUT_MS));

  /** The public callback URL: ADMIN_ORIGIN plus the query the IdP sent. */
  const callbackUrl = (requestUrl: string) => {
    const url = new URL("/api/auth/callback", env.ADMIN_ORIGIN);
    url.search = new URL(requestUrl).search;
    return url;
  };

  const preAuthOptions = (maxAge: number) => ({
    httpOnly: true,
    secure: env.secureSite,
    // Lax, not Strict: the IdP's redirect back is a cross-site top-level GET.
    sameSite: "Lax" as const,
    path: "/",
    maxAge,
  });

  /** Locale-less on purpose (the SPA adds the locale); /forbidden is exempt from the sign-in guard, so a failure cannot loop. */
  const failure = (code: string) => {
    const url = new URL("/forbidden", env.ADMIN_ORIGIN);
    url.searchParams.set("auth_error", code);
    return url.href;
  };

  // A plain GET on purpose: it only ever redirects to the IdP, and the
  // callback's state check ties the answer to this browser.
  app.get("/login", async (c) => {
    c.header("cache-control", "no-store");
    try {
      const { location, sealed } = await auth.startLogin({
        config: auth.getOidcConfig(),
        next: c.req.query("next"),
        register: false,
        deps: { fetch: deps.fetch },
      });
      setCookie(
        c,
        PRE_AUTH_COOKIE,
        sealed,
        preAuthOptions(PRE_AUTH_MAX_AGE_SECONDS),
      );
      return c.redirect(location, 307);
    } catch (error) {
      logger.error("auth.login_failed", {
        requestId: c.get("requestId"),
        ...errorFields(error),
      });
      const config = error instanceof Error && error.name === "OidcConfigError";
      return c.redirect(failure(config ? "config" : "unavailable"), 307);
    }
  });

  // The OIDC redirect URI (`${ADMIN_ORIGIN}/api/auth/callback`). Every failure
  // lands on `/forbidden` with a coarse `?auth_error=` code; details
  // never reach the page. The pre-auth cookie is single-use: cleared on every
  // outcome. Role checks stay in the HTML guard and in apps/server.
  app.get("/callback", async (c) => {
    c.header("cache-control", "no-store");
    let location: string;
    try {
      const result = await auth.completeLogin({
        config: auth.getOidcConfig(),
        callbackUrl: callbackUrl(c.req.url),
        sealed: getCookie(c, PRE_AUTH_COOKIE),
        deps: { fetch: deps.fetch },
      });
      if (result.ok) {
        location = new URL(result.next, env.ADMIN_ORIGIN).href;
        writeSessionCookies(cookieJar(c), result.tokens);
      } else {
        location = failure(result.reason);
      }
    } catch (error) {
      logger.error("auth.callback_failed", {
        requestId: c.get("requestId"),
        ...errorFields(error),
      });
      const config = error instanceof Error && error.name === "OidcConfigError";
      location = failure(config ? "config" : "unavailable");
    }
    setCookie(c, PRE_AUTH_COOKIE, "", preAuthOptions(0));
    return c.redirect(location, 307);
  });

  // What the SPA knows about the user: identity and roles, never a token.
  app.get("/session", async (c) => {
    c.header("cache-control", "no-store");
    const session = await resolveSession(c, auth, deps.fetch);
    if (session.idpUnavailable) {
      // Retryable: the IdP is down, not the session.
      return c.json({ authenticated: false, error: "unavailable" }, 503);
    }
    if (session.state !== "active" || !session.accessToken) {
      return c.json({ authenticated: false }, 401);
    }
    const identity = session.idToken
      ? decodeSessionIdentity(session.idToken)
      : {};
    const sub = decodeSessionClaims(session.accessToken)?.sub;
    return c.json({
      authenticated: true,
      email: identity.email ?? identity.username ?? "",
      ...(identity.name ? { name: identity.name } : {}),
      ...(sub ? { sub } : {}),
      roles: decodeSessionRoles(session.accessToken),
    });
  });

  // Sign-out (was a Server Action). The custom header cannot be set by a
  // cross-site form or a no-cors fetch, which makes this a CSRF guard on top
  // of SameSite=Lax. Only the admin session ends: app keeps its own cookies.
  app.post("/logout", async (c) => {
    c.header("cache-control", "no-store");
    // A browser that declares the request cross-site is refused outright;
    // `same-origin` and `none` (no such header: scripts, curl) fall through to
    // the header check.
    const fetchSite = c.req.header("sec-fetch-site");
    if (
      !c.req.header("x-requested-with") ||
      fetchSite === "cross-site" ||
      fetchSite === "same-site"
    ) {
      return c.json(
        { code: "permission_denied", message: "cross-site or missing header" },
        403,
      );
    }
    const refreshToken = getCookie(c, REFRESH_COOKIE);
    const idToken = getCookie(c, ID_COOKIE);
    // Always first: whatever happens at the IdP, this browser is signed out.
    clearSessionCookies(cookieJar(c));
    try {
      const config = auth.getOidcConfig();
      if (refreshToken) {
        await auth.revokeRefreshToken({
          config,
          refreshToken,
          deps: { fetch: deps.fetch },
        });
      }
      const endSessionUrl = await auth.buildEndSessionUrl({
        config,
        idToken,
        deps: { fetch: deps.fetch },
      });
      return c.json({ endSessionUrl });
    } catch (error) {
      logger.warn("auth.logout_idp_failed", {
        requestId: c.get("requestId"),
        ...errorFields(error),
      });
      return c.json({ endSessionUrl: null });
    }
  });

  return app;
}
