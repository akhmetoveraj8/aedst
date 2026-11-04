import { edgeEnv } from "@/shared/env/edge";

/**
 * Unverified JWT claims — for UX decisions only (is this access token
 * expired? whose Sentry context is this? should the admin link render?).
 * Authorization is always decided by apps/server, which verifies the
 * signature on every call; never gate anything sensitive on what this
 * returns.
 */
export type SessionClaims = { sub?: string; exp?: number };

const EXPIRY_SKEW_SECONDS = 30;

/**
 * Where the roles live in the access token. Mirrors apps/server's
 * `AEDST_OIDC_ROLES_CLAIM`: `roles` for first-party tokens, a dotted path
 * such as `realm_access.roles` for Keycloak. Read via
 * shared/env/edge because proxy.ts needs it too.
 */
const ROLES_CLAIM = edgeEnv.AUTH_ROLES_CLAIM;

/**
 * Mirrors apps/server's `AEDST_OIDC_ROLES_ORG`: for an object-shaped claim
 * (ZITADEL's `urn:zitadel:iam:org:project:roles`, `{role: {orgId: domain}}`)
 * keep only roles granted in this organisation. Empty = any organisation.
 */
const ROLES_ORG = edgeEnv.AUTH_ROLES_ORG;

function decodePayload(token: string): Record<string, unknown> | null {
  const payload = token.split(".")[1];
  if (!payload) {
    return null;
  }
  try {
    const base64 = payload.replace(/-/g, "+").replace(/_/g, "/");
    const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
    const json = new TextDecoder().decode(
      Uint8Array.from(atob(padded), (char) => char.charCodeAt(0)),
    );
    const parsed: unknown = JSON.parse(json);
    if (typeof parsed !== "object" || parsed === null) {
      return null;
    }
    return parsed as Record<string, unknown>;
  } catch {
    return null;
  }
}

export function decodeSessionClaims(token: string): SessionClaims | null {
  const claims = decodePayload(token);
  if (!claims) {
    return null;
  }
  const { sub, exp } = claims;
  return {
    sub: typeof sub === "string" ? sub : undefined,
    exp: typeof exp === "number" ? exp : undefined,
  };
}

function rolesFromValue(value: unknown, org: string): string[] {
  if (Array.isArray(value)) {
    return value.filter((item): item is string => typeof item === "string");
  }
  if (typeof value === "string") {
    return value.split(/\s+/).filter(Boolean);
  }
  if (typeof value === "object" && value !== null) {
    // ZITADEL: an object keyed by role name, each value {orgId: orgDomain}.
    // With an org filter a role without organisation info is dropped (fail
    // closed), exactly like apps/server's rolesFromValue.
    return Object.entries(value)
      .filter(([, granted]) => {
        if (!org) {
          return true;
        }
        return (
          typeof granted === "object" &&
          granted !== null &&
          !Array.isArray(granted) &&
          org in granted
        );
      })
      .map(([role]) => role)
      .sort();
  }
  return [];
}

/**
 * Roles from the access token, with the same rules as apps/server's
 * `rolesFromToken`: the exact claim name first, then a dotted path; an
 * array of strings, an object keyed by role, or a space-separated string.
 */
export function decodeSessionRoles(
  token: string,
  claim: string = ROLES_CLAIM,
  org: string = ROLES_ORG,
): string[] {
  const claims = decodePayload(token);
  if (!claims) {
    return [];
  }
  if (claim in claims) {
    return rolesFromValue(claims[claim], org);
  }
  if (!claim.includes(".")) {
    return [];
  }
  let value: unknown = claims;
  for (const part of claim.split(".")) {
    if (typeof value !== "object" || value === null || !(part in value)) {
      return [];
    }
    value = (value as Record<string, unknown>)[part];
  }
  return rolesFromValue(value, org);
}

export type SessionIdentity = {
  email?: string;
  name?: string;
  username?: string;
};

/**
 * Who the ID token says is signed in — display only. ZITADEL puts
 * email/profile claims into the ID token only when the application has
 * "User Info inside ID Token" (idTokenUserinfoAssertion) enabled.
 */
export function decodeSessionIdentity(idToken: string): SessionIdentity {
  const claims = decodePayload(idToken);
  if (!claims) {
    return {};
  }
  const text = (value: unknown) =>
    typeof value === "string" && value ? value : undefined;
  return {
    email: text(claims.email),
    name: text(claims.name),
    username: text(claims.preferred_username),
  };
}

/** True when the token is unreadable or expires within the skew window. */
export function isAccessTokenExpired(
  token: string,
  nowMs: number = Date.now(),
): boolean {
  const claims = decodeSessionClaims(token);
  if (claims?.exp === undefined) {
    return true;
  }
  return claims.exp - EXPIRY_SKEW_SECONDS <= nowMs / 1000;
}
