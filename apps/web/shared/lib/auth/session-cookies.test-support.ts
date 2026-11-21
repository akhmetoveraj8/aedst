// Realistic worst-case session tokens for the cookie-size tests of the app
// (shared/lib/auth/session-cookies.test.ts) and of the admin BFF
// (admin/server/session.test.ts). A browser drops a cookie whose name, value
// and attributes exceed 4096 bytes, silently, which here would mean a sign-in
// that never sticks.
import type { SessionTokens } from "@/shared/lib/auth/session-cookies";

/** RFC 6265bis: the limit for one cookie (name + value + attributes), in bytes. */
export const MAX_COOKIE_BYTES = 4096;
/** The roadmap.sh ceiling for cookies on one domain. */
export const MAX_COOKIES_PER_DOMAIN = 20;

const base64url = (value: string) =>
  Buffer.from(value, "utf8").toString("base64url");

/** A JWT of the shape ZITADEL issues: RS256 (2048-bit key, 342-character signature). */
function jwt(claims: Record<string, unknown>): string {
  const header = { alg: "RS256", kid: "312909075212468632", typ: "JWT" };
  return `${base64url(JSON.stringify(header))}.${base64url(JSON.stringify(claims))}.${"s".repeat(342)}`;
}

/** `count` project roles, granted in one organisation, as ZITADEL asserts them. */
function roleGrants(count: number): Record<string, Record<string, string>> {
  return Object.fromEntries(
    Array.from({ length: count }, (_, index) => [
      `role-name-${String(index).padStart(2, "0")}`,
      { "312909075212468001": "organisation.example.com" },
    ]),
  );
}

/** A 14-letter name in a two-byte script (escaped: source files are English-only). */
const TWO_BYTE_NAME = String.fromCodePoint(0x431).repeat(14);

const PROJECT_ID = "312909075212468002";
const standardClaims = {
  iss: "https://identity.organisation.example.com",
  sub: "312909075212468003",
  aud: ["312909075212468004", "312909075212468005", PROJECT_ID],
  exp: 1_800_000_900,
  iat: 1_800_000_000,
  nbf: 1_800_000_000,
  client_id: "312909075212468004",
  jti: "312909075212468006",
};

/**
 * The largest tokens this template treats as realistic: a staff user holding
 * `roles` project roles (ZITADEL writes the roles claim twice: generic and
 * project-scoped), the longest name and email the profile form accepts, a
 * non-Latin display name, and an opaque refresh token of 512 characters.
 */
export function realisticMaxTokens(roles = 8): SessionTokens {
  const grants = roleGrants(roles);
  const roleClaims = {
    "urn:zitadel:iam:org:project:roles": grants,
    [`urn:zitadel:iam:org:project:${PROJECT_ID}:roles`]: grants,
  };
  return {
    accessToken: jwt({ ...standardClaims, ...roleClaims }),
    refreshToken: "r".repeat(512),
    accessMaxAgeSeconds: 43_200,
    refreshMaxAgeSeconds: 30 * 24 * 60 * 60,
    idToken: jwt({
      ...standardClaims,
      ...roleClaims,
      amr: ["pwd", "mfa", "otp"],
      auth_time: 1_800_000_000,
      at_hash: "a".repeat(22),
      c_hash: "c".repeat(22),
      sid: "312909075212468007",
      name: `${TWO_BYTE_NAME} `.repeat(4).trim(),
      given_name: `${TWO_BYTE_NAME} ${TWO_BYTE_NAME}`,
      family_name: TWO_BYTE_NAME,
      preferred_username: `${"long.user.name".repeat(4)}@organisation.example.com`,
      email: `${"long.user.name".repeat(4)}@organisation.example.com`,
      email_verified: true,
      locale: "tg",
      updated_at: 1_800_000_000,
    }),
  };
}

/** The `Set-Cookie` line Next.js and Hono emit for one cookie, for byte counting. */
export function serializeSetCookie(
  name: string,
  value: string,
  options?: {
    httpOnly?: boolean;
    secure?: boolean;
    sameSite?: string;
    path?: string;
    maxAge?: number;
  },
): string {
  return [
    `${name}=${encodeURIComponent(value)}`,
    options?.path ? `Path=${options.path}` : "",
    options?.maxAge === undefined ? "" : `Max-Age=${options.maxAge}`,
    // Both frameworks also write Expires next to Max-Age.
    options?.maxAge === undefined ? "" : `Expires=${new Date(0).toUTCString()}`,
    options?.httpOnly ? "HttpOnly" : "",
    options?.secure ? "Secure" : "",
    options?.sameSite ? `SameSite=${options.sameSite}` : "",
  ]
    .filter(Boolean)
    .join("; ");
}

export const byteLength = (text: string) => Buffer.byteLength(text, "utf8");
