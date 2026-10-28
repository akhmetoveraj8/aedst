#!/usr/bin/env node
// Negative self-test of the web enforcement gates. Run with:
//
//   pnpm check:selftest
//
// Every "mandatory library per concern" rule (Biome rules and GritQL plugins,
// check-feature-boundaries.sh, check-color-literals, check-forms,
// check-naming.sh) is run against a deliberately broken fixture and MUST
// fail with the expected message; the `control-*` fixtures are clean and MUST
// pass, which proves the harness is not just failing everything.
//
// Fixtures: lint/fixtures/*.fixture. Header lines (`//// run: <kind>`,
// `//// expect: <text | pass>`) then one or more `//// file: <path>` sections
// whose bodies are written into a temp tree, with the app's real
// biome.json (VCS off), lint/*.grit and scripts. Nothing under src is
// touched. Uses only node built-ins.
import { spawnSync } from "node:child_process";
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const webDir = dirname(dirname(fileURLToPath(import.meta.url)));
const repoRoot = dirname(dirname(dirname(webDir)));
const fixturesDir = join(webDir, "lint", "fixtures");
const biomeBin = join(
  webDir,
  "node_modules",
  "@biomejs",
  "biome",
  "bin",
  "biome",
);

const depcruiseBin = join(
  webDir,
  "node_modules",
  "dependency-cruiser",
  "bin",
  "dependency-cruiser.mjs",
);

function parseFixture(name) {
  const text = readFileSync(join(fixturesDir, name), "utf8");
  const fixture = { name, run: "", expect: "", files: [] };
  let current = null;
  for (const line of text.split(/\r?\n/)) {
    const header = /^\/\/\/\/ (run|expect|file): ?(.*)$/.exec(line);
    if (header) {
      if (header[1] === "file") {
        current = { path: header[2].trim(), lines: [] };
        fixture.files.push(current);
      } else {
        fixture[header[1]] = header[2].trim();
        current = null;
      }
    } else if (current) {
      current.lines.push(line);
    }
  }
  return fixture;
}

function makeTree(fixture, withApp) {
  // Mirrors the workspace: <base>/app is the project (the dir returned), the
  // source-only kit is its sibling <base>/shared, the Biome config is <base>.
  const base = mkdtempSync(join(tmpdir(), "aedst-selftest-"));
  const dir = join(base, "app");
  mkdirSync(join(base, "shared"), { recursive: true });
  mkdirSync(join(dir, "src"), { recursive: true });
  for (const file of fixture.files) {
    const target = file.path.startsWith("src/shared/")
      ? join(base, "shared", file.path.slice("src/shared/".length))
      : join(dir, file.path);
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, `${file.lines.join("\n").trimEnd()}\n`);
  }
  if (fixture.run === "deps") {
    cpSync(
      join(webDir, ".dependency-cruiser.cjs"),
      join(dir, ".dependency-cruiser.cjs"),
    );
    writeFileSync(
      join(dir, "tsconfig.json"),
      JSON.stringify({
        compilerOptions: {
          baseUrl: ".",
          paths: { "@/shared/*": ["../shared/*"], "@/*": ["./src/*"] },
        },
      }),
    );
  }
  if (withApp) {
    const config = JSON.parse(
      readFileSync(join(webDir, "..", "biome.json"), "utf8"),
    );
    config.root = true;
    config.vcs = { enabled: false };
    delete config.$schema;
    writeFileSync(join(base, "biome.json"), JSON.stringify(config));
    cpSync(join(webDir, "lint"), join(dir, "lint"), {
      recursive: true,
      filter: (source) => !source.includes("fixtures"),
    });
  }
  return dir;
}

const sh = (command, args, options) =>
  spawnSync(command, args, { encoding: "utf8", ...options });

const runners = {
  biome: (dir) =>
    sh(process.execPath, [biomeBin, "lint", "--max-diagnostics=200", "."], {
      cwd: dirname(dir),
    }),
  boundaries: (dir) =>
    sh("bash", [join(webDir, "scripts", "check-feature-boundaries.sh")], {
      env: { ...process.env, AEDST_WEB_ROOT: dir },
    }),
  deps: (dir) =>
    sh(
      process.execPath,
      [depcruiseBin, "src", "../shared", "--config", ".dependency-cruiser.cjs"],
      {
        cwd: dir,
      },
    ),
  colors: (dir) =>
    sh(
      process.execPath,
      [join(webDir, "scripts", "check-color-literals.mjs")],
      {
        env: { ...process.env, AEDST_WEB_ROOT: dir },
      },
    ),
  forms: (dir) =>
    sh(process.execPath, [join(webDir, "scripts", "check-forms.mjs")], {
      env: { ...process.env, AEDST_WEB_ROOT: dir },
    }),
  rootcolors: (dir) => {
    sh("git", ["init", "-q"], { cwd: dir });
    return sh(
      process.execPath,
      [join(repoRoot, "scripts", "check-color-literals.mjs")],
      {
        env: { ...process.env, AEDST_COLOR_ROOT: dir },
      },
    );
  },
  naming: (dir, fixture) =>
    sh("bash", [join(repoRoot, "scripts", "check-naming.sh"), "--stdin"], {
      cwd: dir,
      input: fixture.files.map((file) => file.path).join("\n"),
    }),
};

const rows = [];
for (const name of readdirSync(fixturesDir)
  .filter((n) => n.endsWith(".fixture"))
  .sort()) {
  const fixture = parseFixture(name);
  const runner = runners[fixture.run];
  if (!runner || !fixture.expect || fixture.files.length === 0) {
    rows.push({ name, ok: false, why: "malformed fixture (run/expect/file)" });
    continue;
  }
  const dir = makeTree(fixture, fixture.run === "biome");
  try {
    const result = runner(dir, fixture);
    const output = `${result.stdout ?? ""}${result.stderr ?? ""}`;
    const failed = result.status !== 0;
    if (fixture.expect === "pass") {
      rows.push({
        name,
        ok: !failed,
        why: failed ? `control fixture failed:\n${output.slice(0, 1500)}` : "",
      });
    } else if (!failed) {
      rows.push({
        name,
        ok: false,
        why: "gate PASSED a broken fixture (the rule is not enforced)",
      });
    } else if (!output.includes(fixture.expect)) {
      rows.push({
        name,
        ok: false,
        why: `failed, but without "${fixture.expect}":\n${output.slice(0, 1500)}`,
      });
    } else {
      rows.push({ name, ok: true, why: "" });
    }
  } finally {
    rmSync(dirname(dir), { recursive: true, force: true });
  }
}

for (const row of rows) {
  console.log(
    `${row.ok ? "ok  " : "FAIL"} ${row.name}${row.why ? `  ${row.why}` : ""}`,
  );
}
const failures = rows.filter((row) => !row.ok).length;
if (failures > 0) {
  console.error(`\n${failures} of ${rows.length} self-test case(s) failed.`);
  process.exit(1);
}
console.log(`\nSelf-test OK: ${rows.length} fixtures behave as expected.`);
