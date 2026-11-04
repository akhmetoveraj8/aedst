// Reads docs/content/**/*.md(x) straight from disk. Generic on purpose: new pages appear in
// llms.txt, llms-full.txt and the sitemap without registering them anywhere.
// Uses only erasable TypeScript syntax so `node --test` can import it directly.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync } from "node:fs";
import { basename, join } from "node:path";

export type DocPage = {
  /** Path under content/, with forward slashes (for example "web/deployment.md"). */
  file: string;
  /** URL path, "/" for the home page (for example "/web/deployment"). */
  route: string;
  title: string;
  description: string;
  /** Markdown without front matter (and without MDX import/export lines). */
  body: string;
};

export function splitFrontMatter(text: string): { data: Record<string, string>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---[ \t]*(?:\r?\n|$)/);
  if (!m) return { data: {}, body: text };
  const data: Record<string, string> = {};
  // Flat `key: value` scalars only (the docs convention); surrounding quotes are stripped.
  for (const line of m[1].split(/\r?\n/)) {
    const kv = line.match(/^([A-Za-z][\w-]*):\s*(.*)$/);
    if (!kv) continue;
    const v = kv[2].trim();
    data[kv[1]] = /^".*"$/.test(v) ? v.slice(1, -1).replace(/\\(["\\])/g, "$1") : v.replace(/^'(.*)'$/, "$1");
  }
  return { data, body: text.slice(m[0].length) };
}

export function routeFor(file: string): string {
  const noExt = file.replace(/\.mdx?$/i, "");
  const route = noExt === "index" ? "" : noExt.replace(/\/index$/, "");
  return `/${route}`;
}

const FENCE = /^\s*(```|~~~)/;

function firstParagraph(body: string): string {
  let fence = false;
  const para: string[] = [];
  for (const line of body.split(/\r?\n/)) {
    if (FENCE.test(line)) {
      fence = !fence;
      continue;
    }
    if (fence) continue;
    const t = line.trim();
    if (!t || /^(#|\||>|-|\*|\d+\.|<|import |export )/.test(t)) {
      if (para.length) break;
      continue;
    }
    para.push(t);
  }
  return para
    .join(" ")
    .replace(/\[([^\]]*)\]\([^)]*\)/g, "$1")
    .replace(/[`*_]/g, "");
}

function walk(dir: string, rel = ""): string[] {
  const out: string[] = [];
  for (const e of readdirSync(join(dir, rel), { withFileTypes: true })) {
    const p = rel ? `${rel}/${e.name}` : e.name;
    if (e.isDirectory()) out.push(...walk(dir, p));
    else if (/\.mdx?$/i.test(e.name) && !e.name.startsWith("_")) out.push(p);
  }
  return out;
}

export function loadPages(contentDir: string): DocPage[] {
  const pages = walk(contentDir).map((file): DocPage => {
    const { data, body: raw } = splitFrontMatter(readFileSync(join(contentDir, file), "utf8"));
    const body = /\.mdx$/i.test(file) ? raw.replace(/^(import|export)\s.*$/gm, "") : raw;
    const h1 = body.match(/^#\s+(.+?)\s*#*\s*$/m)?.[1];
    return {
      file,
      route: routeFor(file),
      title: data.title || h1 || basename(file).replace(/\.mdx?$/i, ""),
      description: data.description || firstParagraph(body),
      body: body.trim(),
    };
  });
  return pages.sort((a, b) => (a.route === "/" ? -1 : b.route === "/" ? 1 : a.route.localeCompare(b.route)));
}

/** Last commit date of a file (ISO), from git; falls back to DOCS_LASTMOD, then undefined. */
export function lastModified(path: string, env: Record<string, string | undefined> = process.env): string | undefined {
  try {
    const out = execFileSync("git", ["log", "-1", "--format=%cI", "--", path], { stdio: ["ignore", "pipe", "ignore"] })
      .toString()
      .trim();
    if (out) return out;
  } catch {
    // no git or not a checkout: fall through
  }
  return env.DOCS_LASTMOD?.trim() || undefined;
}

export function llmsTxt(pages: DocPage[], origin: string, name: string, summary: string): string {
  const lines = [`# ${name}`, "", `> ${summary}`, "", "## Pages", ""];
  for (const p of pages) {
    lines.push(`- [${p.title}](${origin}${p.route})${p.description ? `: ${p.description}` : ""}`);
  }
  lines.push("", `Full text of every page: ${origin}/llms-full.txt`, "");
  return lines.join("\n");
}

export function llmsFullTxt(pages: DocPage[], origin: string, name: string): string {
  const parts = pages.map((p) => `Source: ${origin}${p.route}\n\n${p.body}\n`);
  return `# ${name}\n\n${parts.join("\n---\n\n")}`;
}
