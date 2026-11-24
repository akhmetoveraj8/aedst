#!/usr/bin/env node
// Post-build step of the static export: turns the HTML in `out/` into the
// response headers the static host must send.
//
// A static page has no request to bind a nonce to, so `script-src` lists the
// SHA-256 hash of every inline script that page contains (the theme script,
// Next's hydration payloads, its bootstrap loader) and nothing else: no
// `'unsafe-inline'`, no `'unsafe-eval'`, no third-party origin. The hashes are
// computed from the emitted bytes, so they can never drift from the page.
// `application/ld+json` blocks are data, not script, and are not hashed.
//
// Outputs (generated, never edited, git-ignored with `out/`):
//   out/_headers                   Netlify / Cloudflare Pages format
//   headers/pages.json             URL -> headers, read by scripts/serve-out.mjs
//   headers/nginx-pages.conf       one exact `location` per page, for deployments/nginx
//   headers/nginx-common.conf      the headers every response carries
//
// Also: serves the default locale's 404 document as `404.html` (hosts that
// pick `/404.html` automatically) and drops Next's unlocalized `_not-found`.
//
// Uses only node built-ins. Run from apps/web/marketing after `next build`.
import { createHash } from "node:crypto";
import {
  copyFileSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from "node:fs";
import { join, relative, resolve, sep } from "node:path";

import { buildCsp, COMMON_HEADERS, CSP_FALLBACK } from "./security-policy.mjs";

const root = resolve(process.argv[2] ?? process.cwd());
const outDir = join(root, "out");
const headersDir = join(root, "headers");
const DEFAULT_LOCALE = "en";
const INLINE_SCRIPT = /<script\b([^>]*)>([\s\S]*?)<\/script>/g;

function* walk(dir) {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    if (statSync(path).isDirectory()) {
      yield* walk(path);
    } else {
      yield path;
    }
  }
}

function inlineScriptHashes(html) {
  const hashes = new Set();
  for (const [, attributes, body] of html.matchAll(INLINE_SCRIPT)) {
    if (/\bsrc\s*=/.test(attributes)) {
      continue;
    }
    if (/\btype\s*=\s*["']application\/ld\+json["']/.test(attributes)) {
      continue;
    }
    hashes.add(
      `'sha256-${createHash("sha256").update(body).digest("base64")}'`,
    );
  }
  return [...hashes].sort();
}

/** `out/en/privacy.html` -> `/en/privacy`; `out/index.html` -> `/`. */
function urlOf(file) {
  const rel = relative(outDir, file)
    .split(sep)
    .join("/")
    .replace(/\.html$/, "");
  return rel === "index" ? "/" : `/${rel}`;
}

// Next's unlocalized not-found document carries inline styles, which the strict
// `style-src 'self'` would block. Replace it with the default locale's page.
const localized404 = join(outDir, DEFAULT_LOCALE, "404.html");
copyFileSync(localized404, join(outDir, "404.html"));
for (const stale of ["_not-found.html", "_not-found.txt", "_not-found"]) {
  rmSync(join(outDir, stale), { recursive: true, force: true });
}

const pages = {};
for (const file of walk(outDir)) {
  if (!file.endsWith(".html") || relative(outDir, file) === "404.html") {
    continue;
  }
  const html = readFileSync(file, "utf8");
  // `style-src 'self'` blocks inline styles: fail the build, not the visitor.
  if (/<style\b|\sstyle\s*=\s*"/.test(html)) {
    throw new Error(
      `${relative(root, file)} contains an inline style, which style-src 'self' blocks`,
    );
  }
  const hashes = inlineScriptHashes(html);
  pages[urlOf(file)] = {
    file: relative(outDir, file).split(sep).join("/"),
    csp: buildCsp(hashes),
  };
}

// --- headers/pages.json (the test and preview server) ---
mkdirSync(headersDir, { recursive: true });
writeFileSync(
  join(headersDir, "pages.json"),
  `${JSON.stringify({ common: COMMON_HEADERS, fallbackCsp: CSP_FALLBACK, pages }, null, 2)}\n`,
);

// --- out/_headers ---
const commonLines = Object.entries(COMMON_HEADERS).map(
  ([name, value]) => `  ${name}: ${value}`,
);
// Cloudflare Pages and Netlify JOIN the values of every matching rule, and two
// CSP headers intersect: the catch-all block carries the common headers only,
// and each page rule adds just its own CSP (assets are not documents).
const blocks = [
  ["/*", ...commonLines].join("\n"),
  [
    "/_next/static/*",
    "  Cache-Control: public, max-age=31536000, immutable",
  ].join("\n"),
  ...Object.entries(pages).map(([url, { csp }]) =>
    [
      url,
      `  Content-Security-Policy: ${csp}`,
      "  Cache-Control: public, max-age=0, must-revalidate",
    ].join("\n"),
  ),
];
writeFileSync(join(outDir, "_headers"), `${blocks.join("\n\n")}\n`);

// --- headers/nginx-*.conf ---
// nginx drops every inherited add_header as soon as a block declares its own,
// so each exact location includes the common file and adds its CSP.
const nginxCommon = Object.entries(COMMON_HEADERS)
  .map(([name, value]) => `add_header ${name} "${value}" always;`)
  .join("\n");
writeFileSync(
  join(headersDir, "nginx-common.conf"),
  `# Generated by scripts/build-security-headers.mjs. Do not edit.\n${nginxCommon}\n`,
);

const locations = Object.entries(pages).map(([url, { file, csp }]) =>
  [
    `location = ${url} {`,
    "  include /etc/nginx/aedst/nginx-common.conf;",
    `  add_header Content-Security-Policy "${csp}" always;`,
    '  add_header Cache-Control "public, max-age=0, must-revalidate" always;',
    `  try_files /${file} =404;`,
    "}",
  ].join("\n"),
);
writeFileSync(
  join(headersDir, "nginx-pages.conf"),
  `# Generated by scripts/build-security-headers.mjs. Do not edit.\n${locations.join("\n\n")}\n`,
);

const hashCount = Object.values(pages).reduce(
  (sum, { csp }) => sum + (csp.match(/'sha256-/g) ?? []).length,
  0,
);
console.log(
  `Security headers: ${Object.keys(pages).length} pages, ${hashCount} inline-script hashes -> out/_headers, headers/`,
);
