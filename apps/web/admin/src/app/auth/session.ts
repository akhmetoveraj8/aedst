import * as z from "zod/mini";

/**
 * The SPA never sees tokens. The BFF answers `GET /api/auth/session` from its
 * httpOnly cookie: `200` with who is signed in, or `401`. Roles are UI hints
 * only; apps/server's RoleInterceptor is the real guard.
 */
const sessionSchema = z.object({
  authenticated: z.literal(true),
  email: z.string(),
  name: z.optional(z.string()),
  // Opaque, non-PII user id for error/analytics context (falls back to a constant).
  sub: z.optional(z.string()),
  roles: z.array(z.string()),
});

export type Session = {
  email: string;
  name?: string;
  sub?: string;
  roles: readonly string[];
};

/** `null` = anonymous (401). Any other failure throws and reaches the error boundary. */
async function fetchSession(signal?: AbortSignal): Promise<Session | null> {
  const response = await fetch("/api/auth/session", {
    credentials: "same-origin",
    headers: { accept: "application/json" },
    signal,
  });
  if (response.status === 401) {
    return null;
  }
  if (!response.ok) {
    throw new Error(`Session probe failed with HTTP ${response.status}`);
  }
  const { authenticated: _authenticated, ...session } = sessionSchema.parse(
    await response.json(),
  );
  return session;
}

const SESSION_TTL_MS = 5 * 60_000;
let cached: { promise: Promise<Session | null>; at: number } | undefined;

/**
 * The session, probed once and reused by every navigation (the root route's
 * `beforeLoad` runs on each one, so a per-navigation fetch would be a waterfall).
 * A failed probe is not cached.
 */
export function loadSession(): Promise<Session | null> {
  if (cached && Date.now() - cached.at < SESSION_TTL_MS) {
    return cached.promise;
  }
  const entry = { promise: fetchSession(), at: Date.now() };
  entry.promise.catch(() => {
    if (cached === entry) {
      cached = undefined;
    }
  });
  cached = entry;
  return entry.promise;
}

/** Forget the cached session (sign-out, or a 401 from an RPC). */
export function clearSession(): void {
  cached = undefined;
}
