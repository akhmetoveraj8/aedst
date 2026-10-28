const FALLBACK = "/tasks";

// biome-ignore lint/suspicious/noControlCharactersInRegex: rejecting control chars is the point
const CONTROL_CHARS = /[\u0000-\u001f\u007f]/;

function isUnsafe(path: string): boolean {
  return (
    path.startsWith("//") || path.includes("\\") || CONTROL_CHARS.test(path)
  );
}

/**
 * The candidate when it is a same-origin absolute path, else `null`. For any
 * navigation target that came from data (a `next` query param, a server-sent
 * notification or search-hit link): protocol URLs (`https:`, `javascript:`),
 * `//host`, backslash tricks and control characters are refused, in the raw
 * and in the percent-decoded form (a router or proxy may decode), so the app
 * can never be turned into an open redirect.
 */
export function safeInAppPath(
  candidate: string | null | undefined,
): string | null {
  if (!candidate?.startsWith("/") || isUnsafe(candidate)) {
    return null;
  }
  try {
    if (isUnsafe(decodeURIComponent(candidate))) {
      return null;
    }
  } catch {
    return null; // malformed escape sequence
  }
  return candidate;
}

/** `safeInAppPath` with a fallback destination (the post-login `next` param). */
export function safeRedirectPath(
  candidate: string | null | undefined,
  fallback: string = FALLBACK,
): string {
  return safeInAppPath(candidate) ?? fallback;
}
