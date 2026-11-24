#!/usr/bin/env node
// Serves `out/` with the headers `build-security-headers.mjs` generated, the
// way deployments/nginx does: exact page URLs, the locale negotiation of `/`,
// a per-locale 404, the page's own CSP. It is the server behind `pnpm start`,
// the Playwright run and Lighthouse CI, so the specs see the headers
// production sends. It is NOT a production server (use deployments/nginx).
//
//   node scripts/serve-out.mjs [--port 3002]
//
// Uses only node built-ins.
import { createReadStream, existsSync, readFileSync, statSync } from "node:fs";
import { createServer } from "node:http";
import { extname, join, normalize, resolve, sep } from "node:path";
import { pipeline } from "node:stream";

const root = resolve(import.meta.dirname, "..");
const outDir = join(root, "out");
const portFlag = process.argv.lastIndexOf("--port");
const port = Number(
  (portFlag > 0 ? process.argv[portFlag + 1] : process.env.PORT) ?? 3002,
);
const { common, fallbackCsp, pages } = JSON.parse(
  readFileSync(join(root, "headers", "pages.json"), "utf8"),
);

const LOCALES = ["en", "ru", "tj", "uz", "ar"];
// Accept-Language uses BCP 47 `tg` for Tajik; the URL locale is `tj`.
const TAG_TO_LOCALE = { en: "en", ru: "ru", tg: "tj", uz: "uz", ar: "ar" };
const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "text/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json",
  ".webmanifest": "application/manifest+json",
  ".txt": "text/plain; charset=utf-8",
  ".xml": "application/xml",
  ".png": "image/png",
  ".ico": "image/x-icon",
  ".woff2": "font/woff2",
  ".woff": "font/woff",
};

/** First listed language wins (browsers list by preference). */
function negotiateLocale(header = "") {
  const first = header.split(",")[0]?.trim().toLowerCase().split(/[-;]/)[0];
  return TAG_TO_LOCALE[first] ?? "en";
}

function send(res, status, headers, file) {
  res.writeHead(status, headers);
  if (!file) {
    res.end();
    return;
  }
  pipeline(createReadStream(file), res, () => res.destroy());
}

function notFound(res, pathname) {
  const first = pathname.split("/")[1];
  const locale = LOCALES.includes(first) ? first : "en";
  const page = pages[`/${locale}/404`];
  send(
    res,
    404,
    {
      ...common,
      "Content-Type": TYPES[".html"],
      "Content-Security-Policy": page.csp,
    },
    join(outDir, page.file),
  );
}

createServer((req, res) => {
  const url = new URL(req.url ?? "/", "http://localhost");
  const pathname = decodeURIComponent(url.pathname);

  if (pathname === "/") {
    send(res, 302, {
      ...common,
      Location: `/${negotiateLocale(req.headers["accept-language"])}`,
      Vary: "Accept-Language",
    });
    return;
  }
  if (pathname.length > 1 && pathname.endsWith("/")) {
    send(res, 308, { ...common, Location: pathname.slice(0, -1) });
    return;
  }

  const page = pages[pathname];
  if (page) {
    send(
      res,
      200,
      {
        ...common,
        "Content-Type": TYPES[".html"],
        "Content-Security-Policy": page.csp,
        "Cache-Control": "public, max-age=0, must-revalidate",
      },
      join(outDir, page.file),
    );
    return;
  }

  const file = normalize(join(outDir, pathname));
  const inside = file.startsWith(outDir + sep);
  const hidden = /\/(_headers)$/.test(pathname);
  if (!inside || hidden || !existsSync(file) || !statSync(file).isFile()) {
    notFound(res, pathname);
    return;
  }
  const immutable = pathname.startsWith("/_next/static/");
  send(
    res,
    200,
    {
      ...common,
      "Content-Type": TYPES[extname(file)] ?? "application/octet-stream",
      "Content-Security-Policy": fallbackCsp,
      "Cache-Control": immutable
        ? "public, max-age=31536000, immutable"
        : "public, s-maxage=3600, stale-while-revalidate=86400",
    },
    file,
  );
}).listen(port, "127.0.0.1", () => {
  console.log(`Ready: serving out/ at http://127.0.0.1:${port}`);
});
