#!/usr/bin/env node
// ZITADEL is AGPL-3.0. We stay clear of its copyleft by only ever running the
// UNMODIFIED official images as a separate service (docs/content/server/licensing-agpl.md).
// This check fails when deployment files reference a non-official or patched ZITADEL image,
// build an image FROM zitadel, copy/clone/build ZITADEL source, import its Go module, or
// (for Kubernetes/Helm paths) reference an official image without a digest pin.
//
//   node scripts/check-zitadel-agpl.mjs             scan apps/server, run the negative self-test first
//   node scripts/check-zitadel-agpl.mjs --self-test only the self-test
import { readdirSync, readFileSync, statSync } from "node:fs";
import { dirname, join, relative, resolve, sep } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const SKIP_DIRS = new Set(["node_modules", ".git", "gen", ".local", ".next"]);
const SCAN_ROOT = "apps/server";
const SCANNED = /(^|\/)(Dockerfile[^/]*|go\.mod|[^/]+\.(ya?ml|sh|tpl|json|mk|toml))$|(^|\/)Makefile$/;
// Docs under apps/server/docs and markdown talk ABOUT zitadel; they are not deployment inputs.
const IGNORED_PREFIX = ["apps/server/docs/", "apps/server/specs/", "apps/server/internal/", "apps/server/api/"];

// Official images only: ghcr.io/zitadel/zitadel and ghcr.io/zitadel/zitadel-login, tag (or a
// compose ${VAR:-default} tag) and/or a sha256 digest.
const OFFICIAL =
  /^ghcr\.io\/zitadel\/(?:zitadel|zitadel-login)(?::(?:[\w.-]+|\$\{[A-Z_]+:-[\w.-]+\}))?(?:@sha256:[0-9a-f]{64})?$/;
const DIGEST = /@sha256:[0-9a-f]{64}/;
const PINNED_PATH = /^apps\/server\/deployments\/(?:k8s|helm)\/|helm-values/;

function stripComment(line) {
  return line.replace(/\s+#.*$/, "").trim();
}

function unquote(v) {
  return v.trim().replace(/^["']|["']$/g, "");
}

/** @param {string} path repo-relative, forward slashes  @param {string} text  @returns {string[]} violations */
export function scanFile(path, text) {
  const out = [];
  if (IGNORED_PREFIX.some((p) => path.startsWith(p)) || !SCANNED.test(path)) return out;
  const lines = text.split(/\r?\n/);
  const isDockerfile = /(^|\/)Dockerfile[^/]*$/.test(path);
  const bad = (n, msg) => out.push(`${path}:${n + 1}: ${msg}`);

  lines.forEach((raw, n) => {
    const line = stripComment(raw);
    if (!line || raw.trimStart().startsWith("#")) return;

    // 1. Image references: `image:`, `repository:`, FROM, COPY --from, docker run/pull.
    const refs = [];
    let m = line.match(/^-?\s*(?:image|repository):\s*(\S+)/);
    if (m) refs.push(unquote(m[1]));
    m = line.match(/^FROM\s+(?:--\S+\s+)*(\S+)/i);
    if (m && isDockerfile) {
      if (/zitadel/i.test(m[1])) bad(n, `Dockerfile builds FROM a ZITADEL image (${m[1]}): never derive images from ZITADEL`);
      return;
    }
    m = line.match(/--from=(\S+)/);
    if (m && isDockerfile && /zitadel/i.test(m[1])) bad(n, `COPY --from a ZITADEL stage/image (${m[1]}): never copy ZITADEL files into our images`);
    m = line.match(/\bdocker\s+(?:run|pull)\b.*?\s(\S*zitadel\S*)/i);
    if (m) refs.push(unquote(m[1]));

    for (const ref of refs) {
      if (!/zitadel/i.test(ref)) continue;
      if (!OFFICIAL.test(ref)) {
        bad(n, `non-official or patched ZITADEL image "${ref}" (only ghcr.io/zitadel/zitadel and ghcr.io/zitadel/zitadel-login are allowed)`);
      } else if (PINNED_PATH.test(path) && !DIGEST.test(ref)) {
        // A sibling `digest: sha256:...` line within the next 3 lines also counts.
        const near = lines.slice(n, n + 4).join("\n");
        if (!/digest:\s*["']?sha256:[0-9a-f]{64}/.test(near)) {
          bad(n, `ZITADEL image "${ref}" in a Kubernetes/Helm path must be pinned by digest (@sha256:...)`);
        }
      }
    }

    // 2. ZITADEL source or build steps (any scanned file type).
    if (/\bgit\s+clone\b.*github\.com[/:]zitadel\/zitadel(?:\.git)?(?:\s|$|")/i.test(line)) bad(n, "clones the ZITADEL source repository");
    if (/\bgo\s+(?:install|get|build)\b.*github\.com\/zitadel\/zitadel(?:\/|@|\s|$)/i.test(line)) bad(n, "builds or fetches the ZITADEL Go module");
    if (isDockerfile && /^(?:COPY|ADD)\b.*zitadel/i.test(line)) bad(n, "Dockerfile copies ZITADEL files/source into an image");
    if (/\bpatch\b.*\bzitadel\b|\bgit\s+apply\b.*zitadel|\bzitadel\b.*\.(?:patch|diff)\b/i.test(line)) bad(n, "applies a patch to ZITADEL");

    // 3. Linking the AGPL module into our Go code (github.com/zitadel/oidc, /schema, /logging are Apache-2.0 and fine).
    if (/(^|\/)go\.mod$/.test(path) && /\bgithub\.com\/zitadel\/zitadel(?:\/v\d+)?\s+v/.test(line)) {
      bad(n, "go.mod requires github.com/zitadel/zitadel (AGPL-3.0): linking it makes our server a derivative work");
    }
  });
  return out;
}

/** Files that must not exist: copied ZITADEL source/patches next to the deployment. */
export function scanPaths(paths) {
  const out = [];
  for (const p of paths) {
    if (/^apps\/server\/deployments\/zitadel\//.test(p) && /(\.go|\.patch|\.diff|go\.mod|go\.sum)$/.test(p)) {
      out.push(`${p}: ZITADEL source or patch file inside the deployment directory`);
    }
  }
  return out;
}

function walk(dir, acc) {
  for (const name of readdirSync(dir)) {
    if (SKIP_DIRS.has(name)) continue;
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, acc);
    else acc.push(full);
  }
  return acc;
}

function scanTree() {
  const files = walk(join(root, SCAN_ROOT), []).map((f) => relative(root, f).split(sep).join("/"));
  const out = scanPaths(files);
  for (const rel of files) {
    out.push(...scanFile(rel, readFileSync(join(root, rel), "utf8")));
  }
  return { out, count: files.length };
}

const D = "a".repeat(64);
const cases = [
  // [path, text, expected violation count (0 = must pass)]
  ["apps/server/deployments/docker/docker-compose.yml", "    image: ghcr.io/zitadel/zitadel:${AEDST_ZITADEL_VERSION:-v4.20.0}\n    image: ghcr.io/zitadel/zitadel-login:v4.20.0", 0],
  ["apps/server/deployments/k8s/x/a.yaml", `  image: ghcr.io/zitadel/zitadel:v4.20.0@sha256:${D}`, 0],
  ["apps/server/deployments/zitadel/helm-values.example.yaml", `image:\n  repository: ghcr.io/zitadel/zitadel\n  digest: sha256:${D}`, 0],
  ["apps/server/deployments/zitadel/README.md", "image: evil/zitadel", 0], // not a scanned type: docs may discuss anything
  ["apps/server/deployments/docker/Dockerfile", "FROM golang:1.26\nCOPY . .", 0],
  ["apps/server/go.mod", "\tgithub.com/zitadel/oidc/v3 v3.40.0\n", 0],
  ["apps/server/deployments/docker/docker-compose.yml", "    image: myregistry.example/zitadel:v4", 1],
  ["apps/server/deployments/docker/docker-compose.yml", "    image: ghcr.io/aedst/zitadel-patched:1", 1],
  ["apps/server/deployments/docker/docker-compose.yml", "    image: zitadel/zitadel:v4", 1],
  ["apps/server/deployments/k8s/x/a.yaml", "  image: ghcr.io/zitadel/zitadel:v4.20.0", 1], // no digest in a k8s path
  ["apps/server/deployments/zitadel/helm-values.example.yaml", "image:\n  repository: ghcr.io/zitadel/zitadel\n  tag: v4", 1],
  ["apps/server/deployments/docker/Dockerfile.idp", "FROM ghcr.io/zitadel/zitadel:v4\nRUN true", 1],
  ["apps/server/deployments/docker/Dockerfile", "COPY --from=ghcr.io/zitadel/zitadel:v4 /app/zitadel /zitadel", 2], // --from and COPY zitadel
  ["apps/server/deployments/docker/Dockerfile", "COPY zitadel-src/ /src/", 1],
  ["apps/server/deployments/zitadel/bootstrap.sh", "git clone https://github.com/zitadel/zitadel.git", 1],
  ["apps/server/deployments/zitadel/bootstrap.sh", "go build github.com/zitadel/zitadel/cmd", 1],
  ["apps/server/deployments/zitadel/bootstrap.sh", "git apply my-fix.patch # zitadel", 0], // comment-only mention is ignored
  ["apps/server/deployments/zitadel/bootstrap.sh", "git apply zitadel-fix.patch", 1],
  ["apps/server/go.mod", "\tgithub.com/zitadel/zitadel v1.0.0\n", 1],
  ["apps/server/go.mod", "\tgithub.com/zitadel/zitadel/v2 v2.0.0\n", 1],
  ["apps/server/deployments/docker/docker-compose.yml", "    command: docker run --rm evil.io/zitadel-fork:1", 1],
];

function selfTest() {
  let failed = 0;
  for (const [path, text, want] of cases) {
    const got = scanFile(path, text).length;
    if (got !== want) {
      failed++;
      console.error(`self-test FAILED: ${path} expected ${want} violation(s), got ${got}\n  ${text.split("\n")[0]}`);
    }
  }
  const pathCases = [
    ["apps/server/deployments/zitadel/main.go", 1],
    ["apps/server/deployments/zitadel/fix.patch", 1],
    ["apps/server/deployments/zitadel/bootstrap.sh", 0],
    ["apps/server/internal/x/main.go", 0],
  ];
  for (const [p, want] of pathCases) {
    if (scanPaths([p]).length !== want) {
      failed++;
      console.error(`self-test FAILED (path): ${p} expected ${want}`);
    }
  }
  if (failed) process.exit(1);
  console.log(`check-zitadel-agpl: self-test OK (${cases.length + pathCases.length} cases, includes negative cases)`);
}

selfTest();
if (!process.argv.includes("--self-test")) {
  const { out, count } = scanTree();
  if (out.length) {
    console.error("check-zitadel-agpl: ZITADEL (AGPL-3.0) must stay unmodified and separate. Violations:");
    for (const v of out) console.error("  " + v);
    console.error("See docs/content/server/licensing-agpl.md");
    process.exit(1);
  }
  console.log(`check-zitadel-agpl: OK (${count} files under ${SCAN_ROOT} scanned)`);
}
