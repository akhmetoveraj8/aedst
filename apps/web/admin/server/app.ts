import { Hono } from "hono";
import { compress } from "hono/compress";
import { HTTPException } from "hono/http-exception";
import { requestId } from "hono/request-id";
import { secureHeaders } from "hono/secure-headers";
import { staticFiles } from "./http/static";
import { authRoutes } from "./routes/auth";
import { healthRoutes } from "./routes/health";
import { htmlHandler } from "./routes/html";
import { rpcRoutes } from "./routes/rpc";
import { buildApiContentSecurityPolicy } from "./security/csp";
import type { AppBindings, AppDeps } from "./types";

const isApiPath = (path: string) => path.startsWith("/api/");

/**
 * The admin backend-for-frontend: static files of the Vite build, the OIDC
 * session endpoints, the authenticated `/api/rpc` proxy to apps/server, and the guarded, nonce-stamped HTML. All I/O comes in through
 * `deps` so tests inject fetch, the IdP calls and the index.html.
 */
export function createApp(deps: AppDeps) {
  const app = new Hono<AppBindings>();

  app.use("*", requestId());
  app.use("*", async (c, next) => {
    const started = Date.now();
    await next();
    if (c.req.path !== "/api/healthz") {
      deps.logger.info("request", {
        requestId: c.get("requestId"),
        method: c.req.method,
        // Path only: query strings carry OIDC codes and states.
        path: c.req.path,
        status: c.res.status,
        ...(deps.env.TRUST_PROXY
          ? // The rightmost entry is the one our own proxy appended; the
            // leftmost is whatever the client chose to send.
            { ip: c.req.header("x-forwarded-for")?.split(",").at(-1)?.trim() }
          : {}),
        ms: Date.now() - started,
      });
    }
  });
  app.use(
    "*",
    secureHeaders({
      xFrameOptions: "DENY",
      referrerPolicy: "strict-origin-when-cross-origin",
      strictTransportSecurity: "max-age=63072000; includeSubDomains; preload",
      crossOriginOpenerPolicy: "same-origin",
      crossOriginResourcePolicy: "same-origin",
      xDnsPrefetchControl: "off",
      permissionsPolicy: {
        camera: [],
        microphone: [],
        geolocation: [],
        payment: [],
        usb: [],
        browsingTopics: [],
      },
    }),
  );
  // Belt and braces next to the noindex meta tag: nothing here is indexable.
  app.use("*", async (c, next) => {
    await next();
    c.header("x-robots-tag", "noindex, nofollow");
  });
  // JSON and redirects never render a document: nothing may load or frame them.
  app.use("*", async (c, next) => {
    await next();
    if (isApiPath(c.req.path)) {
      c.header("content-security-policy", buildApiContentSecurityPolicy());
      if (!c.res.headers.has("cache-control")) {
        c.header("cache-control", "no-store");
      }
    }
  });
  // Streaming RPC responses must not be buffered by a compressor.
  app.use("*", (c, next) =>
    isApiPath(c.req.path) ? next() : compress()(c, next),
  );

  app.route("/", healthRoutes);
  app.route("/api/auth", authRoutes(deps));
  app.route("/api/rpc", rpcRoutes(deps));
  app.all("/api/*", (c) =>
    c.json({ code: "not_found", message: "unknown route" }, 404),
  );

  app.use("*", staticFiles(deps.staticDir));
  app.get("*", htmlHandler(deps));
  app.all("*", (c) => c.text("Method not allowed", 405));

  app.onError((error, c) => {
    // A middleware (the callback timeout) already chose its status.
    if (error instanceof HTTPException) {
      return error.getResponse();
    }
    deps.logger.error("request.unhandled", {
      requestId: c.get("requestId"),
      path: c.req.path,
      errorName: error.name,
    });
    return c.json({ code: "internal", message: "internal error" }, 500);
  });
  return app;
}
