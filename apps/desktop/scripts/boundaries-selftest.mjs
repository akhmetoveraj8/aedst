// Negative self-test of check-feature-boundaries.mjs: a good tree must pass and one seeded violation per
// rule must fail with that rule's id. Fixtures are written to a temporary directory, never to the repo.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const pkg = (name, body = '') => `[package]\nname = "${name}"\nversion = "0.0.0"\n\n${body}`;
const dep = (name) => `${name} = { path = "../${name}" }\n`;

/** The good tree: one flat feature, one split feature, core crates, the shell and an excluded spike. */
function goodTree() {
  const files = {
    'Cargo.toml': '[workspace]\nmembers = ["crates/*"]\nexclude = ["crates/aedst-spike"]\n',
    'crates/aedst-desktop/Cargo.toml': pkg('aedst-desktop', `[dependencies]\n${dep('aedst-feature-tasks')}${dep('aedst-feature-wallet')}`),
    'crates/aedst-desktop/src/main.rs': 'use aedst_feature_tasks::TasksController;\nfn main() {}\n',
    'crates/aedst-desktop/ui/shell.slint': 'import { TasksView } from "../../aedst-feature-tasks/ui/tasks.slint";\n',
    'crates/aedst-ui/Cargo.toml': pkg('aedst-ui'),
    'crates/aedst-ui/ui/lib.slint': 'import { ComboBox } from "std-widgets.slint";\nexport component AedstSelect {}\n',
    'crates/aedst-navigation/src/lib.rs': '// a comment may name aedst_feature_tasks\npub struct Router;\n',
    'crates/aedst-spike/Cargo.toml': pkg('aedst-spike', `[dependencies]\n${dep('aedst-feature-tasks')}`),
    'crates/aedst-spike/ui/spike.slint': 'import { Button } from "std-widgets.slint";\n',
    'crates/aedst-feature-tasks/Cargo.toml': pkg(
      'aedst-feature-tasks',
      `[dependencies]\n${dep('aedst-api')}${dep('aedst-common')}serde = { workspace = true }\n\n[dev-dependencies]\n${dep('aedst-persistence')}`,
    ),
    'crates/aedst-feature-tasks/build.rs': 'fn main() { let _ = "../aedst-ui/ui/lib.slint"; }\n',
    'crates/aedst-feature-tasks/src/lib.rs': '//! The shell wires `aedst_navigation::Router`.\npub mod domain;\nuse aedst_api::call;\n',
    'crates/aedst-feature-tasks/src/domain/mod.rs': 'use aedst_common::ErrorKind;\n',
    'crates/aedst-feature-tasks/tests/outbox.rs': 'use aedst_persistence::Database;\n',
    'crates/aedst-feature-tasks/ui/tasks.slint':
      '// no raw std-widgets control except ListView\nimport { AedstButton } from "@aedst-ui";\nimport { ListView } from "std-widgets.slint";\nimport { Row } from "task_row.slint";\nexport component TasksView {}\n',
    'crates/aedst-feature-tasks/ui/task_row.slint': 'export component Row {}\n',
    'crates/aedst-feature-wallet/Cargo.toml': pkg('aedst-feature-wallet', `[dependencies]\n${dep('aedst-common')}`),
    'crates/aedst-feature-wallet/src/lib.rs': 'pub mod history;\npub mod shared;\npub mod transfer;\nuse crate::transfer::Transfer;\n',
    'crates/aedst-feature-wallet/src/shared/mod.rs': 'pub struct Money;\n',
    'crates/aedst-feature-wallet/src/transfer/domain/mod.rs': 'use crate::shared::Money;\nuse crate::transfer::domain::Rule;\n',
    'crates/aedst-feature-wallet/src/history/domain/mod.rs': 'use crate::shared::Money;\n',
    'crates/aedst-feature-wallet/ui/shared/amount.slint': 'export component Amount {}\n',
    'crates/aedst-feature-wallet/ui/transfer/transfer.slint': 'import { Amount } from "../shared/amount.slint";\n',
    'crates/aedst-feature-wallet/ui/history/history.slint': 'import { AedstLabel } from "@aedst-ui";\n',
  };
  for (const core of ['aedst-api', 'aedst-common', 'aedst-contract', 'aedst-outbox', 'aedst-persistence', 'aedst-navigation']) {
    files[`crates/${core}/Cargo.toml`] = pkg(core);
  }
  return files;
}

const TASKS = 'crates/aedst-feature-tasks';
const WALLET = 'crates/aedst-feature-wallet';
const append = (file, text) => (files) => {
  files[file] = `${files[file] ?? ''}${text}`;
};

// [name, expected rule, mutation of the good tree]
const CASES = [
  ['feature depends on a feature (Cargo.toml)', 'D1', append(`${TASKS}/Cargo.toml`, dep('aedst-feature-wallet'))],
  ['feature uses a feature (Rust)', 'D1', append(`${TASKS}/src/lib.rs`, 'use aedst_feature_wallet::Money;\n')],
  ['feature depends on a core crate outside the allowlist', 'D2', (files) => {
    files[`${WALLET}/Cargo.toml`] += dep('aedst-navigation');
  }],
  ['test-only crate as a normal dependency', 'D2', (files) => {
    files[`${WALLET}/Cargo.toml`] += dep('aedst-persistence');
  }],
  ['feature uses a test-only crate in production code', 'D3', append(`${TASKS}/src/domain/mod.rs`, 'use aedst_persistence::Database;\n')],
  ['feature build.rs reaches into a core crate by path', 'D3', append(`${TASKS}/build.rs`, 'const P: &str = "../aedst-navigation/src";\n')],
  ['core crate depends on a feature (Cargo.toml)', 'D4', append('crates/aedst-common/Cargo.toml', `[dependencies]\n${dep('aedst-feature-tasks')}`)],
  ['core crate uses a feature (Rust)', 'D4', append('crates/aedst-navigation/src/lib.rs', 'use aedst_feature_tasks::TasksController;\n')],
  ['core crate imports a feature view (Slint)', 'D4', append('crates/aedst-ui/ui/lib.slint', 'import { TasksView } from "../../aedst-feature-tasks/ui/tasks.slint";\n')],
  ['feature imports std-widgets', 'D5', append(`${TASKS}/ui/task_row.slint`, 'import { Button } from "std-widgets.slint";\n')],
  ['feature imports ListView together with another widget', 'D5', append(`${TASKS}/ui/task_row.slint`, 'import { ListView, Button } from "std-widgets.slint";\n')],
  ['feature imports a view of another crate', 'D5', append(`${TASKS}/ui/task_row.slint`, 'import { Amount } from "../../aedst-feature-wallet/ui/shared/amount.slint";\n')],
  ['layer folders mixed with a feature folder', 'D6', append(`${TASKS}/src/reminders/domain/mod.rs`, 'pub struct Reminder;\n')],
  ['ui folder without its Rust module', 'D6', append(`${WALLET}/ui/limits/limits.slint`, 'export component Limits {}\n')],
  ['flat crate with a ui folder', 'D6', append(`${TASKS}/ui/detail/detail.slint`, 'export component Detail {}\n')],
  ['split feature imports another feature (Rust)', 'D6', append(`${WALLET}/src/transfer/domain/mod.rs`, 'use crate::history::domain::Entry;\n')],
  ['shared imports a feature (Rust)', 'D6', append(`${WALLET}/src/shared/mod.rs`, 'use crate::transfer::Transfer;\n')],
  ['split feature imports another feature (Slint)', 'D6', append(`${WALLET}/ui/history/history.slint`, 'import { T } from "../transfer/transfer.slint";\n')],
];

function write(root, files) {
  for (const [file, text] of Object.entries(files)) {
    const full = path.join(root, file);
    mkdirSync(path.dirname(full), { recursive: true });
    writeFileSync(full, text);
  }
}

/** Runs `check` over the good tree and every seeded violation; returns true when the gate behaves. */
export function selfTest(check) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'aedst-desktop-boundaries-'));
  let failed = 0;
  try {
    const good = path.join(tmp, 'good');
    write(good, goodTree());
    const clean = check(good).violations;
    if (clean.length > 0) {
      failed += 1;
      console.log(`FAIL  good tree reported: ${clean.map((v) => `${v.rule} ${v.where}`).join('; ')}`);
    } else {
      console.log('ok    good tree passes');
    }
    CASES.forEach(([name, rule, mutate], index) => {
      const root = path.join(tmp, `bad-${index}`);
      const files = goodTree();
      mutate(files);
      write(root, files);
      const rules = check(root).violations.map((v) => v.rule);
      if (rules.length > 0 && rules.every((found) => found === rule)) {
        console.log(`ok    ${rule} fails: ${name}`);
      } else {
        failed += 1;
        console.log(`FAIL  ${name}: expected only ${rule}, got ${rules.join(', ') || 'no violation'}`);
      }
    });
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  console.log(failed === 0 ? `self-test: ${CASES.length} seeded violations caught` : `self-test: ${failed} case(s) wrong`);
  return failed === 0;
}
