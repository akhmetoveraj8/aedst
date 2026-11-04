import { serveStatic } from "@hono/node-server/serve-static";
import type { Context, MiddlewareHandler } from "hono";

/** A path whose last segment has an extension is a file, not a document route. */
export function isAssetPath(path: string): boolean {
  const last = path.split("/").pop() ?? "";
  return last.includes(".");
}

const IMMUTABLE = "public, max-age=31536000, immutable";
const REVALIDATE = "public, max-age=3600";

/**
 * Serves the Vite build files. Hashed `assets/*` are immutable for a year;
 * other files (favicon, robots.txt) revalidate hourly. `index.html` is never
 * served from here: it carries the nonce placeholder and only the HTML route
 * may answer with it.
 */
export function staticFiles(root: string): MiddlewareHandler {
  // serveStatic calls onFound after it has built the response, so a header set
  // there is lost; remember the hit and stamp the cache policy afterwards.
  const found = new WeakSet<Context>();
  const serve = serveStatic({
    root,
    onFound: (_path, c) => {
      found.add(c);
    },
  });
  return async (c, next) => {
    const path = c.req.path;
    if (!isAssetPath(path)) {
      return next();
    }
    const hidden = path.split("/").some((part) => part.startsWith("."));
    if (hidden || path.endsWith(".html")) {
      return c.text("Not found", 404);
    }
    const result = await serve(c, next);
    if (found.has(c) && result instanceof Response) {
      result.headers.set(
        "cache-control",
        path.startsWith("/assets/") ? IMMUTABLE : REVALIDATE,
      );
    }
    return result;
  };
}
