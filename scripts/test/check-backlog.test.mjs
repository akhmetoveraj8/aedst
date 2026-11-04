// Negative self-test of scripts/check-backlog.mjs: `node --test scripts/test`.
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";

const script = join(dirname(fileURLToPath(import.meta.url)), "..", "check-backlog.mjs");

function run(body) {
  const dir = mkdtempSync(join(tmpdir(), "backlog-"));
  const file = join(dir, "backlog.md");
  writeFileSync(file, body);
  try {
    return spawnSync(process.execPath, [script], {
      encoding: "utf8",
      env: { ...process.env, AEDST_BACKLOG_FILE: file },
    });
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test("valid statuses pass", () => {
  const result = run(
    [
      "- [x] web-1 [medium] A - done (fixed)",
      "- [x] web-2 [low] B - duplicate-of web-1",
      "- [x] apple-1 [low] C - done-UNVERIFIED (check on first build)",
      "- [ ] desktop-1 [low] D - blocked (needs Qt: run task desktop:test)",
    ].join("\n"),
  );
  assert.equal(result.status, 0, result.stderr);
});

test("an item without a status fails", () => {
  assert.notEqual(run("- [ ] web-1 [medium] A\n").status, 0);
});

test("skipped is forbidden", () => {
  assert.notEqual(run("- [x] web-1 [medium] A - skipped\n").status, 0);
});

test("a blocked item needs a reason", () => {
  assert.notEqual(run("- [ ] web-1 [medium] A - blocked\n").status, 0);
});

test("a checked box with an open status fails", () => {
  assert.notEqual(
    run("- [x] web-1 [medium] A - owner-decision (choose the vendor)\n").status,
    0,
  );
});
