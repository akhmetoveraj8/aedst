// Self-test for check-docs.mjs: runs the checker against a throw-away fixture tree.
import assert from "node:assert/strict";
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { checkRepo, globToRe } from "./check-docs.mjs";

function fixture(files) {
  const root = mkdtempSync(join(tmpdir(), "check-docs-"));
  for (const [p, body] of Object.entries(files)) {
    mkdirSync(dirname(join(root, p)), { recursive: true });
    writeFileSync(join(root, p), body);
  }
  return root;
}

const ru = "\u041f\u0440\u0438\u0432\u0435\u0442"; // Cyrillic sample, escaped on purpose

test("reports broken links, missing paths, prompt paths and Cyrillic; accepts good ones", () => {
  const root = fixture({
    "docs/a.md": "[ok](b.md) [bad](missing.md) [web](https://x.y) [anchor](#top)\n```\n[ignored](nope.md)\n```\n`[inline](nope2.md)`\n",
    "docs/b.md": "text\n",
    "docs/archive/old.md": ru,
    "docs/c.md": ru,
    "scripts/x.sh": "cat docs/b.md\ncat docs/gone.md\n",
    ".github/workflows/w.yml": "jobs:\n  j:\n    steps:\n      - with:\n          prompt: |\n            Read `docs/b.md` and docs/nope.md\n",
  });
  try {
    const v = checkRepo({ root, allowText: "" });
    const key = (x) => `${x.rule}:${x.file}`;
    const got = v.map(key);
    assert.ok(got.includes("links:docs/a.md"));
    assert.equal(v.filter((x) => x.rule === "links").length, 1);
    assert.ok(got.includes("cyrillic:docs/c.md"));
    assert.ok(!got.includes("cyrillic:docs/archive/old.md"));
    assert.ok(got.includes("paths:scripts/x.sh"));
    assert.equal(v.filter((x) => x.rule === "paths" && x.file === "scripts/x.sh").length, 1);
    assert.ok(v.some((x) => x.file === ".github/workflows/w.yml" && x.line === 6 && x.message.includes("docs/nope.md"))); // same line+path reported once
    const allowed = checkRepo({ root, allowText: "cyrillic docs/c.md\nlinks missing.md\n*  docs/gone.md\n*  docs/nope.md" });
    assert.equal(allowed.length, 0, JSON.stringify(allowed));
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test("globToRe", () => {
  assert.ok(globToRe("**/res/values/*.xml").test("a/b/res/values/s.xml"));
  assert.ok(!globToRe("docs/*.md").test("docs/x/y.md"));
});

test("frontmatter rule: docs/content pages need title and description", () => {
  const root = fixture({
    "docs/content/ok.md": "---\ntitle: T\ndescription: D\n---\n# T\n",
    "docs/content/no-fm.md": "# T\n",
    "docs/content/no-desc.mdx": "---\ntitle: T\n---\n# T\n",
    "docs/content/empty-desc.md": "---\ntitle: T\ndescription:\n---\n# T\n",
    "docs/content/_meta.ts": "export default {};\n",
  });
  try {
    const v = checkRepo({ root, allowText: "" }).filter((x) => x.rule === "frontmatter").map((x) => x.file);
    assert.deepEqual(v, ["docs/content/empty-desc.md", "docs/content/no-desc.mdx", "docs/content/no-fm.md"]);
    assert.equal(checkRepo({ root, allowText: "frontmatter docs/content/no-*" }).filter((x) => x.rule === "frontmatter").length, 1);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
