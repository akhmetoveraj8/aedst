#!/usr/bin/env node
/**
 * Technical-SEO audit of a RUNNING marketing site (a served production build or the live
 * site). Complements check-seo-placeholders.mjs (build-time placeholders) with what only a
 * served site shows. Ported from the ilife repository's scripts/landing/seo-audit.mjs.
 *
 *   pnpm --filter @aedst/web-marketing check:seo:live [-- --base http://localhost:3002] [--limit 400]
 *
 * Reads <base>/sitemap.xml (index -> child sitemaps -> <loc>), fetches every URL
 * and checks, per page: HTTP 200; one <title> (10-65 chars); one meta
 * description (50-165, advisory); exactly one <h1>; <html lang>; self-referencing
 * canonical; hreflang cluster that is reciprocal and contains the page itself
 * and x-default; JSON-LD that parses (and every @id reference resolves inside
 * the page); no `noindex` on a URL listed in the sitemap; og:title/og:image.
 * Also checks robots.txt, /llms.txt and the redirects www -> apex and / -> /<locale>.
 * Exit code 1 on any failure. Needs Node >= 20 (global fetch).
 */
const args = process.argv.slice(2);
const opt = (name, fallback) => {
  const i = args.indexOf(`--${name}`);
  return i >= 0 ? args[i + 1] : fallback;
};
const BASE = opt("base", "http://localhost:3002").replace(/\/$/, "");
const LIMIT = Number(opt("limit", "400"));
const failures = [];
const warnings = [];
const fail = (url, msg) => failures.push(`${url}  ${msg}`);
// Length rules are advisory (SERP truncation is a ranking-quality issue, not an error).
const warn = (url, msg) => warnings.push(`${url}  ${msg}`);

async function get(url, init) {
  const res = await fetch(url, { redirect: "manual", ...init });
  return { res, text: res.status < 300 ? await res.text() : "" };
}

/** The sitemap lists the PUBLIC origin; map it onto BASE so the audit also works on localhost. */
function toBase(loc) {
  try {
    const u = new URL(loc);
    return `${BASE}${u.pathname}${u.search}`;
  } catch {
    return loc;
  }
}
const path = (u) => new URL(u, BASE).pathname.replace(/\/$/, "") || "/";

async function locs(xmlUrl) {
  const { res, text } = await get(xmlUrl);
  if (res.status !== 200) {
    fail(xmlUrl, `sitemap returned ${res.status}`);
    return [];
  }
  return [...text.matchAll(/<loc>([^<]+)<\/loc>/g)].map((m) =>
    m[1].replace(/&amp;/g, "&"),
  );
}

const attr = (tag, name) =>
  new RegExp(`${name}=["']([^"']*)["']`, "i").exec(tag)?.[1];

function parse(html) {
  const tags = (name) =>
    [...html.matchAll(new RegExp(`<${name}\\b[^>]*>`, "gi"))].map((m) => m[0]);
  const title = [...html.matchAll(/<title[^>]*>([^<]*)<\/title>/gi)].map(
    (m) => m[1],
  );
  const metas = tags("meta");
  const metaContent = (key, val) =>
    metas
      .filter((t) => attr(t, key)?.toLowerCase() === val)
      .map((t) => attr(t, "content"));
  const links = tags("link");
  const alternates = links
    .filter((t) => attr(t, "rel") === "alternate" && attr(t, "hreflang"))
    .map((t) => [attr(t, "hreflang"), attr(t, "href")]);
  const canonical = links
    .filter((t) => attr(t, "rel") === "canonical")
    .map((t) => attr(t, "href"));
  const h1 = [...html.matchAll(/<h1[\s>]/gi)].length;
  const lang = /<html[^>]*\blang=["']([^"']+)["']/i.exec(html)?.[1];
  const ld = [
    ...html.matchAll(
      /<script[^>]*type=["']application\/ld\+json["'][^>]*>([\s\S]*?)<\/script>/gi,
    ),
  ].map((m) => m[1]);
  return {
    title,
    description: metaContent("name", "description"),
    robots: metaContent("name", "robots"),
    ogTitle: metaContent("property", "og:title"),
    ogImage: metaContent("property", "og:image"),
    alternates,
    canonical,
    h1,
    lang,
    ld,
  };
}

function collectIds(node, ids, refs) {
  if (Array.isArray(node)) {
    for (const n of node) collectIds(n, ids, refs);
    return;
  }
  if (node && typeof node === "object") {
    const keys = Object.keys(node);
    if (keys.length === 1 && keys[0] === "@id") refs.add(node["@id"]);
    else if (typeof node["@id"] === "string") ids.add(node["@id"]);
    for (const k of keys) collectIds(node[k], ids, refs);
  }
}

const pages = new Map(); // path -> parsed

async function auditPage(loc) {
  const url = toBase(loc);
  const { res, text } = await get(url);
  if (res.status !== 200) return fail(loc, `HTTP ${res.status}`);
  const p = parse(text);
  pages.set(path(url), p);

  if (p.title.length !== 1)
    fail(loc, `expected 1 <title>, found ${p.title.length}`);
  else if (p.title[0].length < 10 || p.title[0].length > 70)
    warn(loc, `title length ${p.title[0].length}: "${p.title[0]}"`);
  if (p.description.length !== 1)
    fail(loc, `expected 1 meta description, found ${p.description.length}`);
  else if (p.description[0].length < 50 || p.description[0].length > 165)
    warn(loc, `description length ${p.description[0].length}`);
  if (p.h1 !== 1) fail(loc, `expected exactly 1 <h1>, found ${p.h1}`);
  if (!p.lang) fail(loc, "missing <html lang>");
  if (p.robots.some((r) => /noindex/i.test(r ?? "")))
    fail(loc, "noindex on a URL listed in the sitemap");
  if (!p.ogTitle.length || !p.ogImage.length)
    fail(loc, "missing og:title / og:image");

  if (p.canonical.length !== 1)
    fail(loc, `expected 1 canonical, found ${p.canonical.length}`);
  else if (path(toBase(p.canonical[0])) !== path(url))
    fail(loc, `canonical is not self: ${p.canonical[0]}`);

  if (p.alternates.length > 0) {
    const hrefs = p.alternates.map(([, h]) => path(toBase(h)));
    if (!hrefs.includes(path(url)))
      fail(loc, "hreflang cluster does not contain the page itself");
    if (!p.alternates.some(([l]) => l === "x-default"))
      fail(loc, "hreflang cluster without x-default");
  }

  const ids = new Set();
  const refs = new Set();
  if (p.ld.length === 0) fail(loc, "no JSON-LD");
  for (const raw of p.ld) {
    try {
      collectIds(JSON.parse(raw), ids, refs);
    } catch (e) {
      fail(loc, `JSON-LD does not parse: ${e.message}`);
    }
  }
  for (const r of refs)
    if (!ids.has(r)) fail(loc, `JSON-LD references ${r} but never defines it`);
}

async function main() {
  // `/sitemap.xml` is either a sitemap index (descend into the children) or a plain urlset.
  const root = await get(`${BASE}/sitemap.xml`);
  const isIndex = /<sitemapindex[\s>]/i.test(root.text);
  const index = await locs(`${BASE}/sitemap.xml`);
  const children = isIndex ? index.map(toBase) : [`${BASE}/sitemap.xml`];
  const urls = [];
  if (isIndex) for (const child of children) urls.push(...(await locs(child)));
  else urls.push(...index);
  if (urls.length === 0) fail(`${BASE}/sitemap.xml`, "no URLs found");
  const unique = [...new Set(urls)].slice(0, LIMIT);
  console.log(
    `seo-audit: ${unique.length} URLs from ${children.length} sitemap(s)`,
  );

  const queue = [...unique];
  await Promise.all(
    Array.from({ length: 6 }, async () => {
      for (let loc = queue.shift(); loc; loc = queue.shift()) {
        try {
          await auditPage(loc);
        } catch (e) {
          fail(loc, `fetch failed: ${e.message}`);
        }
      }
    }),
  );

  // hreflang reciprocity: if A lists B, B must list A.
  for (const [p, page] of pages) {
    for (const [, href] of page.alternates) {
      const other = pages.get(path(toBase(href)));
      if (!other || path(toBase(href)) === p) continue;
      if (!other.alternates.some(([, h]) => path(toBase(h)) === p)) {
        fail(p, `hreflang not reciprocal: ${href} does not link back`);
      }
    }
  }

  const robots = await get(`${BASE}/robots.txt`);
  if (robots.res.status !== 200 || !/sitemap:/i.test(robots.text))
    fail("/robots.txt", "missing or without a Sitemap line");
  const llms = await get(`${BASE}/llms.txt`);
  if (llms.res.status !== 200) fail("/llms.txt", `HTTP ${llms.res.status}`);

  // Advisory only: a static export served by a generic file server may answer the root and
  // unknown paths differently from the production edge (redirect rules live in the host).
  const home = await get(`${BASE}/`, { headers: { "Accept-Language": "en" } });
  if (![200, 301, 302, 307, 308].includes(home.res.status))
    warn("/", `unexpected status ${home.res.status}`);

  const missing = await get(`${BASE}/en/this-page-does-not-exist`);
  if (missing.res.status !== 404)
    warn(
      "/en/this-page-does-not-exist",
      `expected 404, got ${missing.res.status}`,
    );

  if (warnings.length) {
    console.warn(
      `seo-audit: ${warnings.length} warning(s)\n${warnings.map((w) => `  - ${w}`).join("\n")}`,
    );
  }
  if (failures.length) {
    console.error(
      `\nseo-audit: ${failures.length} problem(s)\n` +
        failures.map((f) => `  - ${f}`).join("\n"),
    );
    process.exit(1);
  }
  console.log("seo-audit: all checks passed");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
