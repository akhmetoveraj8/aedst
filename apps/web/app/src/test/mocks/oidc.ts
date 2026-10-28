import { createSign, generateKeyPairSync, type KeyObject } from "node:crypto";

import { vi } from "vitest";

import { getOidcConfig, type OidcConfig } from "@/shared/lib/auth/oidc/config";

/** Matches `test.env` in vitest.config.mts, so default-config code sees the same IdP. */
export const TEST_ISSUER = "http://localhost:8085";
export const TEST_CLIENT_ID = "aedst-web-test";
const TEST_STATE_SECRET = "test-state-secret-test-state-secret-0123";

export function testOidcConfig(
  overrides: Partial<Parameters<typeof getOidcConfig>[0]> = {},
): OidcConfig {
  return getOidcConfig(
    {
      OIDC_ISSUER: TEST_ISSUER,
      OIDC_CLIENT_ID: TEST_CLIENT_ID,
      OIDC_CLIENT_SECRET: undefined,
      OIDC_PROJECT_ID: "proj-1",
      OIDC_SCOPE: undefined,
      OIDC_STATE_SECRET: TEST_STATE_SECRET,
      ...overrides,
    },
    "http://localhost:3000",
    false,
  );
}

const encode = (value: object) =>
  Buffer.from(JSON.stringify(value)).toString("base64url");

/** An unsigned JWT-shaped string - fine for access tokens, which this app never verifies. */
export function unsignedJwt(claims: object, alg = "RS256"): string {
  return `${encode({ alg, typ: "JWT" })}.${encode(claims)}.c2ln`;
}

const TEST_KEY_ID = "test-key-1";

function newRsaKeyPair() {
  return generateKeyPairSync("rsa", { modulusLength: 2048 });
}

const signingKeys = newRsaKeyPair();
/** A key the fake IdP does not publish: tokens signed with it must fail. */
export const foreignSigningKey: KeyObject = newRsaKeyPair().privateKey;

/** The public JWKS the fake IdP serves at its jwks_uri. */
function testJwks(kid = TEST_KEY_ID) {
  return {
    keys: [
      {
        ...signingKeys.publicKey.export({ format: "jwk" }),
        kid,
        use: "sig",
        alg: "RS256",
      },
    ],
  };
}

type SignOptions = {
  alg?: string;
  kid?: string | null;
  key?: KeyObject;
};

/** An RS256 JWT signed with the fake IdP's key (override alg/kid/key to forge). */
function signedJwt(
  claims: object,
  {
    alg = "RS256",
    kid = TEST_KEY_ID,
    key = signingKeys.privateKey,
  }: SignOptions = {},
): string {
  const header = encode({ alg, typ: "JWT", ...(kid ? { kid } : {}) });
  const input = `${header}.${encode(claims)}`;
  if (alg === "none") {
    return `${input}.`;
  }
  const signature = createSign("RSA-SHA256").update(input).sign(key);
  return `${input}.${signature.toString("base64url")}`;
}

export function idToken(
  claims: { nonce?: string; sub?: string; [claim: string]: unknown } = {},
  options?: SignOptions,
): string {
  const now = Math.floor(Date.now() / 1000);
  return signedJwt(
    {
      iss: TEST_ISSUER,
      aud: [TEST_CLIENT_ID],
      sub: "user-1",
      iat: now,
      exp: now + 600,
      ...claims,
    },
    options,
  );
}

type TokenReply = { status?: number; body: object };

/**
 * A scripted IdP behind an injectable `fetch`: serves discovery and answers
 * the token / revocation endpoints from `onToken`, recording every call.
 */
export function createFakeIdp({
  onToken = () => ({ body: {} }),
  discovery = {},
  jwks,
}: {
  onToken?: (params: URLSearchParams) => TokenReply | Promise<TokenReply>;
  discovery?: Record<string, unknown>;
  /** What the JWKS endpoint serves; defaults to the test signing key. */
  jwks?: object;
} = {}) {
  const tokenCalls: URLSearchParams[] = [];
  const revoked: string[] = [];
  let discoveryCalls = 0;
  let jwksCalls = 0;

  const json = (body: object, status = 200) =>
    new Response(JSON.stringify(body), {
      status,
      headers: { "content-type": "application/json" },
    });

  const fetchMock = vi.fn(
    async (input: string | URL | Request, init?: RequestInit) => {
      const url = new URL(input instanceof Request ? input.url : String(input));
      if (url.pathname === "/.well-known/openid-configuration") {
        discoveryCalls += 1;
        return json({
          issuer: TEST_ISSUER,
          authorization_endpoint: `${TEST_ISSUER}/oauth/v2/authorize`,
          token_endpoint: `${TEST_ISSUER}/oauth/v2/token`,
          end_session_endpoint: `${TEST_ISSUER}/oidc/v1/end_session`,
          revocation_endpoint: `${TEST_ISSUER}/oauth/v2/revoke`,
          jwks_uri: `${TEST_ISSUER}/oauth/v2/keys`,
          code_challenge_methods_supported: ["S256"],
          ...discovery,
        });
      }
      if (url.pathname === "/oauth/v2/keys") {
        jwksCalls += 1;
        return json(jwks ?? testJwks());
      }
      const params = new URLSearchParams(String(init?.body ?? ""));
      if (url.pathname === "/oauth/v2/token") {
        tokenCalls.push(params);
        const reply = await onToken(params);
        return json(reply.body, reply.status ?? 200);
      }
      if (url.pathname === "/oauth/v2/revoke") {
        revoked.push(params.get("token") ?? "");
        return new Response(null, { status: 200 });
      }
      return new Response("not found", { status: 404 });
    },
  );

  return {
    fetch: fetchMock as unknown as typeof fetch,
    fetchMock,
    tokenCalls,
    revoked,
    get discoveryCalls() {
      return discoveryCalls;
    },
    get jwksCalls() {
      return jwksCalls;
    },
  };
}
