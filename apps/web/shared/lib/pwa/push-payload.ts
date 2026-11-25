/**
 * The Web Push payload apps/server's notifications module sends (JSON).
 * Parsed defensively: a push from an older/newer server must still show
 * *something* rather than throw inside the service worker.
 */

export type PushPayload = {
  title: string;
  body?: string | undefined;
  /** In-app relative route, e.g. `/tasks/<id>`. */
  link: string;
  /** Notification id (inbox), used as the OS notification tag. */
  id?: string | undefined;
  kind?: string | undefined;
  tag?: string | undefined;
  lang?: string | undefined;
};

function str(value: unknown): string | undefined {
  return typeof value === "string" && value.length > 0 ? value : undefined;
}

export function parsePushPayload(raw: string | undefined): PushPayload | null {
  if (!raw) {
    return null;
  }
  let data: unknown;
  try {
    data = JSON.parse(raw);
  } catch {
    // A plain-text push is still a notification.
    return { title: raw.slice(0, 120), link: "/notifications" };
  }
  if (typeof data !== "object" || data === null) {
    return null;
  }
  const field = (key: string) => str(Reflect.get(data, key));
  const title = field("title");
  if (!title) {
    return null;
  }
  const id = field("id") ?? field("notificationId");
  return {
    title,
    body: field("body"),
    link: field("link") ?? field("url") ?? "/notifications",
    id,
    kind: field("kind"),
    // Same notification re-sent (e.g. retried delivery) replaces, not stacks.
    tag: id ?? field("tag"),
    lang: field("lang") ?? field("locale"),
  };
}

/**
 * Where a notification click goes. Only same-origin, relative in-app paths
 * are honoured — a push payload must not be able to open an arbitrary site.
 */
export function resolveNotificationUrl(
  link: string | undefined,
  origin: string,
): string {
  const fallback = new URL("/notifications", origin).toString();
  if (!link?.startsWith("/") || link.startsWith("//")) {
    return fallback;
  }
  try {
    const url = new URL(link, origin);
    return url.origin === origin ? url.toString() : fallback;
  } catch {
    return fallback;
  }
}
