#!/usr/bin/env node
// Audit backlog status gate (`task audit:status`). Parses
// docs/audit/2026-10-08-backlog.md and fails when an item has no status or the
// forbidden status `skipped`. Item line shape:
//
//   - [x] web-b2 [medium] Title - done (summary)
//   - [ ] apple-c3 [low] Title - blocked (needs a Mac: run `task apple:test`)
//
// Allowed: done, already-fixed, duplicate-of <id>, done-UNVERIFIED (all `[x]`);
// owner-decision, blocked (both `[ ]`). Prints counters per status and platform.
// AEDST_BACKLOG_FILE points the gate at another file (self-test fixture).
import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const file =
  process.env.AEDST_BACKLOG_FILE ??
  join(root, "docs", "audit", "2026-10-08-backlog.md");

const ITEM = /^- \[( |x)\] (\S+) \[([a-z-]+)\] (.*)$/;
const STATUS =
  /(?:^|\s)(done-UNVERIFIED|done|already-fixed|duplicate-of|owner-decision|blocked|skipped)\b/;
const CHECKED = new Set([
  "done",
  "done-UNVERIFIED",
  "already-fixed",
  "duplicate-of",
]);
const OPEN = new Set(["owner-decision", "blocked"]);

const errors = [];
const byStatus = {};
const byPlatform = {};
const ids = new Set();
let total = 0;

for (const [index, line] of readFileSync(file, "utf8").split(/\r?\n/).entries()) {
  if (!line.startsWith("- [")) continue;
  const where = `${file}:${index + 1}`;
  const match = ITEM.exec(line);
  if (!match) {
    errors.push(`${where}: malformed item line: ${line.slice(0, 80)}`);
    continue;
  }
  const [, box, id, , rest] = match;
  total += 1;
  if (ids.has(id)) errors.push(`${where}: duplicate id ${id}`);
  ids.add(id);
  const title = rest.split(" - ");
  const statusText = title.length > 1 ? title.slice(1).join(" - ") : "";
  const status = STATUS.exec(statusText)?.[1];
  if (!status) {
    errors.push(`${where}: ${id} has no status`);
    continue;
  }
  if (status === "skipped") {
    errors.push(`${where}: ${id} uses the forbidden status "skipped"`);
    continue;
  }
  if (CHECKED.has(status) && box !== "x")
    errors.push(`${where}: ${id} is ${status} but the box is not checked`);
  if (OPEN.has(status) && box === "x")
    errors.push(`${where}: ${id} is ${status} but the box is checked`);
  if (status === "duplicate-of" && !/duplicate-of \S+/.test(statusText))
    errors.push(`${where}: ${id} duplicate-of needs the original id`);
  if ((status === "owner-decision" || status === "blocked") && !/\(.{8,}\)/.test(statusText))
    errors.push(`${where}: ${id} ${status} needs a parenthesised reason/instruction`);
  byStatus[status] = (byStatus[status] ?? 0) + 1;
  const platform = id.split("-")[0];
  byPlatform[platform] = (byPlatform[platform] ?? 0) + 1;
}

if (total === 0) errors.push(`${file}: no backlog items found`);
console.log(`backlog items: ${total}`);
console.log("by status:  ", JSON.stringify(byStatus));
console.log("by platform:", JSON.stringify(byPlatform));
if (errors.length > 0) {
  for (const error of errors) console.error(`::error::${error}`);
  console.error(`\n${errors.length} backlog problem(s).`);
  process.exit(1);
}
console.log("Backlog OK: every item has a valid status.");
