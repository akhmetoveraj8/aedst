#!/usr/bin/env node
// Docs and script hygiene check (repo-wide). Node built-ins only.
//
//   links    relative markdown links resolve (code fences, URLs and anchor-only links skipped)
//   paths    repo paths mentioned in scripts/*.sh and .github/workflows/*.yml exist
//   prompts  repo paths mentioned in workflow `prompt:` blocks and docs/agent/review/*.md exist
//   frontmatter docs/content pages have title and description in front matter
//   cyrillic no Cyrillic outside docs/archive/, locale/i18n directories and the allowlist
//
// Exceptions live in scripts/check-docs.allowlist: `<rule|*> <glob>` per line (# comments).
// For links/paths/prompts the glob matches the *mentioned path* as written; for cyrillic it
// matches the *file*. Output is `file:line: [rule] message`; exit 1 on any violation.
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, posix, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const TEXT_EXT = /\.(md|mdx|txt|ya?ml|json|jsonc|toml|sh|mjs|cjs|js|jsx|ts|tsx|css|html|go|proto|sql|kt|kts|swift|xml|xcstrings|strings|cpp|hpp|h|cc|cmake|qml|ts|gradle|properties|conf|env|example|rules)$/i;
const CYRILLIC = /[Ѐ-ӿ]/;
const ROOTS = "apps|docs|scripts|packages|infra|deployments|\\.github|\\.claude";
const PATH_RE = new RegExp(`(?<![\\w/@$.\\-])((?:${ROOTS})/[A-Za-z0-9_@.\\-/]*[A-Za-z0-9_\\-/])`, "g");
const NAMED_RE = /`([A-Za-z0-9_.\-/]+\.(?:md|ya?ml|json|sh|mjs|toml|txt))`/g;
// Built-in cyrillic allowances (locale data and archived material).
const CYRILLIC_OK = [
  "docs/archive/**",
  "**/i18n/**",
  "**/locales/**",
  "**/res/values-*/**",
  "**/*.xcstrings",
  "**/translations/**",
  "**/*.ts.xml",
  "**/*_ru.*",
  "**/*_tg.*",
];

export function globToRe(glob) {
  let re = "";
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === "*" && glob[i + 1] === "*") {
      i++;
      if (glob[i + 1] === "/") i++, (re += "(?:.*/)?");
      else re += ".*";
    } else if (c === "*") re += "[^/]*";
    else if (c === "?") re += "[^/]";
    else re += c.replace(/[.+^${}()|[\]\\]/g, "\\$&");
  }
  return new RegExp(`^${re}$`);
}

function parseAllowlist(text) {
  return text.split(/\r?\n/).flatMap((raw) => {
    const line = raw.replace(/#.*/, "").trim();
    if (!line) return [];
    const [rule, ...rest] = line.split(/\s+/);
    return [{ rule, re: globToRe(rest.join(" ")) }];
  });
}

function listFiles(root) {
  try {
    const out = execFileSync("git", ["-C", root, "ls-files", "-co", "--exclude-standard", "-z"], { maxBuffer: 1 << 28, stdio: ["ignore", "pipe", "ignore"] });
    return out.toString("utf8").split("\0").filter(Boolean).filter((f) => existsSync(join(root, f)));
  } catch {
    const files = [];
    const walk = (d) => {
      for (const e of readdirSync(join(root, d), { withFileTypes: true })) {
        if (e.name === "node_modules" || e.name === ".git") continue;
        const p = d ? `${d}/${e.name}` : e.name;
        e.isDirectory() ? walk(p) : files.push(p);
      }
    };
    walk("");
    return files;
  }
}

function ignoredSet(root, paths) {
  if (!paths.length) return new Set();
  try {
    const out = execFileSync("git", ["-C", root, "check-ignore", "--stdin", "-z"], { input: paths.join("\0"), maxBuffer: 1 << 26, stdio: ["pipe", "pipe", "ignore"] });
    return new Set(out.toString("utf8").split("\0").filter(Boolean));
  } catch {
    return new Set(); // exit 1 = nothing ignored; no git = no filtering
  }
}

/** Blank out fenced code blocks (keeps line numbers) and inline code spans. */
function stripCode(text) {
  let fence = null;
  return text.split(/\r?\n/).map((line) => {
    const m = line.match(/^\s{0,3}(`{3,}|~{3,})/);
    if (fence) {
      if (m && m[1][0] === fence[0] && m[1].length >= fence.length) fence = null;
      return "";
    }
    if (m) return (fence = m[1]), "";
    return line.replace(/(`+)[^`]*?\1/g, (s) => " ".repeat(s.length));
  });
}

export function checkRepo({ root, files = listFiles(root), allowText = "" }) {
  const allow = parseAllowlist(allowText);
  const allowed = (rule, s) => allow.some((a) => (a.rule === "*" || a.rule === rule) && a.re.test(s));
  const violations = [];
  const pending = []; // missing-path candidates checked against gitignore at the end
  const read = (f) => readFileSync(join(root, f), "utf8");
  const exists = (p) => existsSync(join(root, p));
  const basenames = new Set(files.map((f) => posix.basename(f)));

  const addMissing = (rule, file, line, mentioned, extra) => {
    if (allowed(rule, mentioned)) return;
    pending.push({ rule, file, line, mentioned, extra });
  };

  // links
  const linkRes = [/\[[^\]]*\]\(\s*(<[^>]+>|[^)\s]+)(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g, /^\s{0,3}\[[^\]]+\]:\s*(<[^>]+>|\S+)/g];
  for (const f of files.filter((x) => /\.mdx?$/i.test(x))) {
    stripCode(read(f)).forEach((line, i) => {
      for (const re of linkRes) {
        for (const m of line.matchAll(re)) {
          let t = m[1].replace(/^<|>$/g, "");
          if (/^[a-z][a-z0-9+.-]*:/i.test(t) || t.startsWith("#") || t.startsWith("//") || /[{}$<>]/.test(t)) continue;
          t = t.replace(/[#?].*$/, "");
          if (!t) continue;
          try { t = decodeURI(t); } catch { /* keep raw */ }
          let found;
          if (t.startsWith("/")) {
            const base = t.slice(1).replace(/\/$/, "");
            found = [base, `docs/content/${base}`, `docs/content/${base}.md`, `docs/content/${base}.mdx`, `docs/content/${base}/index.md`, `docs/content/${base}/index.mdx`].some(exists);
          } else {
            found = exists(posix.normalize(posix.join(posix.dirname(f), t)));
          }
          if (!found) addMissing("links", f, i + 1, m[1].replace(/^<|>$/g, ""), `broken link '${m[1]}'`);
        }
      }
    });
  }

  // Workflows and scripts often run with a working directory under apps/<app>, so a path
  // counts as existing when it resolves from the root or from any app directory.
  const BASES = ["", "apps/server/", "apps/web/", "apps/web/app/", "apps/web/admin/", "apps/web/landing/", "apps/android/", "apps/apple/", "apps/desktop-rs/"];
  const existsFromAnyBase = (p) => BASES.some((b) => exists(b + p));

  // paths (scripts and workflows) and prompts (workflow prompt blocks, review prompts)
  const scanPaths = (rule, f, lineText, lineNo) => {
    for (const m of lineText.matchAll(PATH_RE)) {
      const next = lineText[m.index + m[0].length];
      if (next && /[*{$<[]/.test(next)) continue;
      if (next === "." && /[*{]/.test(lineText[m.index + m[0].length + 1] ?? "")) continue;
      if (m[1].includes("...")) continue;
      if (existsFromAnyBase(m[1].replace(/\/$/, ""))) continue;
      addMissing(rule, f, lineNo, m[1], `path '${m[1]}' does not exist`);
    }
    if (rule === "prompts") {
      for (const m of lineText.matchAll(NAMED_RE)) {
        const p = m[1];
        if (p.includes("/") ? existsFromAnyBase(p) : basenames.has(p)) continue;
        if (new RegExp(`^(?:${ROOTS})/`).test(p) === false && p.includes("/") && files.some((x) => x.endsWith(`/${p}`))) continue;
        addMissing("prompts", f, lineNo, p, `path '${p}' does not exist`);
      }
    }
  };
  for (const f of files) {
    const isWf = /^\.github\/workflows\/[^/]+\.ya?ml$/.test(f);
    const isSh = /^scripts\/[^/]+\.sh$/.test(f);
    const isReview = /^docs\/agent\/review\/[^/]+\.md$/.test(f);
    if (!isWf && !isSh && !isReview) continue;
    const lines = read(f).split(/\r?\n/);
    if (isWf || isSh) lines.forEach((l, i) => scanPaths("paths", f, l, i + 1));
    if (isReview) lines.forEach((l, i) => scanPaths("prompts", f, l, i + 1));
    if (isWf) {
      for (let i = 0; i < lines.length; i++) {
        const m = lines[i].match(/^(\s*)(?:-\s+)?[\w-]*prompt[\w-]*:\s*[|>][+-]?\s*$/i);
        if (!m) continue;
        const indent = m[1].length;
        for (let j = i + 1; j < lines.length; j++) {
          const ind = lines[j].match(/^(\s*)/)[1].length;
          if (lines[j].trim() && ind <= indent) break;
          scanPaths("prompts", f, lines[j], j + 1);
        }
      }
    }
  }

  const ignored = ignoredSet(root, [...new Set(pending.filter((p) => p.rule !== "links").map((p) => p.mentioned.replace(/\/$/, "")))]);
  const seen = new Set();
  for (const p of pending) {
    const k = `${p.file}:${p.line}:${p.mentioned}`;
    if (seen.has(k)) continue;
    seen.add(k);
    if (ignored.has(p.mentioned.replace(/\/$/, ""))) continue;
    violations.push({ file: p.file, line: p.line, rule: p.rule, message: p.extra });
  }

  // frontmatter: every docs-site page needs `title` and `description` (SEO, llms.txt, sitemap)
  for (const f of files.filter((x) => /^docs\/content\/.+\.mdx?$/i.test(x) && !posix.basename(x).startsWith("_"))) {
    if (allowed("frontmatter", f)) continue;
    const m = read(f).match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
    const has = (k) => m && new RegExp(`^${k}:[ \\t]*\\S`, "m").test(m[1]);
    const missing = ["title", "description"].filter((k) => !has(k));
    if (missing.length) violations.push({ file: f, line: 1, rule: "frontmatter", message: `front matter lacks ${missing.join(" and ")}` });
  }

  // cyrillic
  const cyrOk = CYRILLIC_OK.map(globToRe);
  for (const f of files) {
    if (!TEXT_EXT.test(f) || f === "scripts/check-docs.mjs" || cyrOk.some((re) => re.test(f)) || allowed("cyrillic", f)) continue;
    let text;
    try { if (statSync(join(root, f)).size > 2_000_000) continue; text = read(f); } catch { continue; }
    if (!CYRILLIC.test(text)) continue;
    const lines = text.split(/\r?\n/);
    const hits = lines.flatMap((l, i) => (CYRILLIC.test(l) ? [i + 1] : []));
    violations.push({ file: f, line: hits[0], rule: "cyrillic", message: `Cyrillic text on ${hits.length} line(s) (English-only policy; move to docs/archive or a locale file, or allowlist the file)` });
  }
  return violations.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
  const allowFile = join(root, "scripts/check-docs.allowlist");
  const v = checkRepo({ root, allowText: existsSync(allowFile) ? readFileSync(allowFile, "utf8") : "" });
  for (const x of v) console.log(`${x.file}:${x.line}: [${x.rule}] ${x.message}`);
  const by = {};
  for (const x of v) by[x.rule] = (by[x.rule] ?? 0) + 1;
  console.log(v.length ? `check-docs: ${v.length} violation(s) ${JSON.stringify(by)}` : "check-docs: OK");
  process.exit(v.length ? 1 : 0);
}
