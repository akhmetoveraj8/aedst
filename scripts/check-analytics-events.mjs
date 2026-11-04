#!/usr/bin/env node
// Every analytics event a client emits must be named in docs/contract/analytics-events.json, and the JSON may only
// list a platform for an event that platform really emits. Source scan, no build needed.
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative } from "node:path";

const root = new URL("..", import.meta.url).pathname.replace(/^\/([A-Za-z]:)/, "$1");
const spec = JSON.parse(readFileSync(join(root, "docs/contract/analytics-events.json"), "utf8")).events;

const SKIP = new Set(["build", "node_modules", ".git", ".gradle", ".next", "Generated", "kotlin-gen"]);
function walk(dir, ext, out = []) {
  for (const name of readdirSync(dir)) {
    if (SKIP.has(name)) continue;
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path, ext, out);
    else if (ext.some((e) => name.endsWith(e)) && !/\/(test|Tests|tests)\//.test(path.replaceAll("\\", "/"))) out.push(path);
  }
  return out;
}

const emitted = { web: new Set(), android: new Set(), apple: new Set(), desktop: new Set() };
const where = {};
const add = (platform, name, file) => {
  emitted[platform].add(name);
  where[`${platform}:${name}`] = relative(root, file);
};

// Web: the AnalyticsEvents type is the vocabulary (track() only accepts its keys).
const web = readFileSync(join(root, "apps/web/shared/lib/analytics/analytics.ts"), "utf8");
const block = web.match(/export type AnalyticsEvents = \{([\s\S]*?)\n\};/);
for (const m of (block?.[1] ?? "").matchAll(/^ {2}([a-z][a-z0-9_]*):/gm)) add("web", m[1], "apps/web/shared/lib/analytics/analytics.ts");

// Android: logEvent("name"...) and the named EVENT constant of SignInAttestation.
for (const f of walk(join(root, "apps/android"), [".kt"])) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/logEvent\(\s*"([a-z][a-z0-9_]*)"/g)) add("android", m[1], f);
  for (const m of text.matchAll(/const val EVENT = "([a-z][a-z0-9_]*)"/g)) add("android", m[1], f);
}

// Apple: AnalyticsEvent(name: "x") and the done/reopened ternary.
for (const f of walk(join(root, "apps/apple"), [".swift"])) {
  const text = readFileSync(f, "utf8");
  for (const m of text.matchAll(/AnalyticsEvent\(\s*name:\s*([^,)]*(?:\?[^,)]*)?)/g)) {
    for (const s of m[1].matchAll(/"([a-z][a-z0-9_]*)"/g)) add("apple", s[1], f);
  }
}

// Desktop (apps/desktop): `.track("name", ...)` calls in production sources (not tests, not doc comments).
for (const f of walk(join(root, "apps/desktop/crates"), [".rs"])) {
  if (f.replaceAll("\\", "/").includes("/target/")) continue;
  const text = readFileSync(f, "utf8")
    .split("\n")
    .filter((l) => !/^\s*\/\//.test(l))
    .join("\n");
  for (const m of text.matchAll(/\.track\(\s*"([a-z][a-z0-9_]*)"/g)) add("desktop", m[1], f);
}

const errors = [];
const warnings = [];
for (const [platform, names] of Object.entries(emitted)) {
  for (const name of names) {
    if (!spec[name]) errors.push(`${platform} emits "${name}" (${where[`${platform}:${name}`]}) which is not in docs/contract/analytics-events.json`);
    else if (!spec[name].platforms.includes(platform)) errors.push(`${platform} emits "${name}" but the JSON does not list ${platform} for it`);
  }
}
for (const [name, def] of Object.entries(spec)) {
  for (const platform of def.platforms) {
    if (!emitted[platform]?.has(name)) {
      const msg = `JSON lists ${platform} for "${name}" but ${platform} does not emit it`;
      // desktop is frozen and does not emit every contract event yet: report, do not gate.
      if (platform === "desktop") warnings.push(msg);
      else errors.push(msg);
    }
  }
}

if (warnings.length) console.warn(`check-analytics-events: ${warnings.length} warning(s) (not gating)\n- ${warnings.join("\n- ")}`);
if (errors.length) {
  console.error(`check-analytics-events: ${errors.length} problem(s)\n- ${errors.join("\n- ")}`);
  process.exit(1);
}
console.log(`check-analytics-events: ${Object.keys(spec).length} events, all platforms consistent`);
