import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { aiCrawlers } from "./ai-crawlers.ts";
import { llmsFullTxt, llmsTxt, loadPages, routeFor, splitFrontMatter } from "./content.ts";
import { DEFAULT_LICENSE, docsLicense, docsRepositoryBase, docsUrl } from "./site.ts";

function fixture(files: Record<string, string>): string {
  const root = mkdtempSync(join(tmpdir(), "docs-content-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}

test("front matter is parsed and stripped", () => {
  const r = splitFrontMatter('---\ntitle: "A: b"\ndescription: Hello\n---\n# H\n');
  assert.deepEqual(r.data, { title: "A: b", description: "Hello" });
  assert.equal(r.body, "# H\n");
  assert.deepEqual(splitFrontMatter("# H\n").data, {});
});

test("routes", () => {
  assert.equal(routeFor("index.mdx"), "/");
  assert.equal(routeFor("web/deployment.md"), "/web/deployment");
  assert.equal(routeFor("web/index.md"), "/web");
});

test("generic discovery: new pages appear in llms.txt and llms-full.txt without front matter", () => {
  const dir = fixture({
    "index.mdx": "---\ntitle: Overview\ndescription: Home page.\n---\nimport X from 'x'\n\n# Docs\n",
    "web/deployment.md": "---\ntitle: Deploy\ndescription: How to deploy.\n---\n\n# Deploy\n\nBody text.\n",
    "seo-geo.md": "# SEO and GEO\n\nFirst paragraph with [a link](/x) and `code`.\n\n```\nnot this\n```\n",
    "_meta.ts": "export default {}",
  });
  const pages = loadPages(dir);
  assert.deepEqual(pages.map((p) => p.route), ["/", "/seo-geo", "/web/deployment"]);
  assert.equal(pages[1].title, "SEO and GEO");
  assert.equal(pages[1].description, "First paragraph with a link and code.");
  assert.ok(!pages[0].body.includes("import X"));

  const index = llmsTxt(pages, "https://d.example", "Docs", "Summary");
  assert.match(index, /^# Docs\n\n> Summary/);
  assert.match(index, /- \[Deploy\]\(https:\/\/d\.example\/web\/deployment\): How to deploy\./);
  assert.match(index, /llms-full\.txt/);

  const full = llmsFullTxt(pages, "https://d.example", "Docs");
  assert.ok(full.includes("Source: https://d.example/web/deployment\n\n# Deploy"));
  assert.ok(full.includes("Source: https://d.example/seo-geo"));
  assert.ok(!full.includes("description: How to deploy"), "front matter must not leak");
});

test("site config defaults are honest", () => {
  assert.equal(docsUrl({}), "http://localhost:3000");
  assert.equal(docsUrl({ NEXT_PUBLIC_DOCS_URL: "https://d.example/" }), "https://d.example");
  assert.equal(docsRepositoryBase({}), undefined);
  assert.equal(docsLicense({}), DEFAULT_LICENSE);
  assert.ok(!/MIT/i.test(DEFAULT_LICENSE));
});

test("AI crawler lists keep the shared names", () => {
  assert.equal(aiCrawlers.answer.length, 7);
  assert.equal(aiCrawlers.training.length, 9);
  assert.ok(aiCrawlers.answer.includes("Claude-SearchBot"));
  assert.ok(aiCrawlers.training.includes("meta-externalagent"));
});
