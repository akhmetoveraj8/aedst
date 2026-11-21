// Negative self-test of check-approved-crates.mjs: a good repository must pass and one seeded violation per
// rule must fail with that rule's id. Fixtures are written to a temporary directory, never to the repo.

import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const LINTS = 'unsafe_code = "LEVEL"\n\n[PREFIXlints.clippy]\nall = { level = "deny", priority = -1 }\nunwrap_used = "deny"\n';

function goodRepo() {
  return {
    'apps/desktop/Cargo.toml':
      '[workspace]\nmembers = ["crates/*"]\nexclude = ["crates/aedst-spike"]\n\n[workspace.dependencies]\n' +
      'tokio = { version = "1.54.1", features = ["rt"] }\nserde = "1.0.229"\nslint = "1.19.0"\n\n[workspace.lints.rust]\n' +
      LINTS.replace('LEVEL', 'deny').replace('PREFIX', 'workspace.'),
    'apps/desktop/approved-crates.txt': '# comment\ntokio\nserde\nslint\n',
    'apps/desktop/deny.toml': '[bans]\ndeny = [\n    { crate = "keyring", reason = "use keyring-core" },\n]\n',
    'apps/desktop/rust-toolchain.toml': '[toolchain]\nchannel = "1.100.0"\n',
    'apps/desktop/crates/aedst-common/Cargo.toml': '[package]\nname = "aedst-common"\n\n[dependencies]\nserde = { workspace = true }\n',
    'apps/desktop/crates/aedst-ui/Cargo.toml':
      '[package]\nname = "aedst-ui"\n\n[dependencies]\naedst-common = { path = "../aedst-common" }\nslint = { workspace = true }\n\n' +
      "[target.'cfg(windows)'.dependencies]\ntokio = { workspace = true }\n",
    'apps/desktop/crates/aedst-spike/Cargo.toml': '[package]\nname = "aedst-spike"\n\n[dependencies]\nunapproved = "1"\n',
    'apps/gateway/Cargo.toml':
      '[package]\nname = "aedst-gateway"\n\n[dependencies]\ntokio = { version = "1.54.1", features = ["signal"] }\naxum = "0.8.9"\n\n' +
      '[dev-dependencies]\nserde = "1.0.229"\n\n[lints.rust]\n' +
      LINTS.replace('LEVEL', 'forbid').replace('PREFIX', ''),
    'apps/gateway/approved-crates.txt': 'tokio\naxum\nserde\n',
    'apps/gateway/deny.toml': '[bans]\ndeny = [{ crate = "openssl", reason = "rustls only" }]\n',
    'apps/gateway/rust-toolchain.toml': '[toolchain]\nchannel = "1.100.0"\n',
    'docs/content/library-first/desktop.md': '| UI | **slint** 1.19.0 |\n| Async | **tokio** 1.54.1, `serde` |\n',
    'docs/content/library-first/gateway.md': '| Runtime | `tokio` 1.54.1, `axum` 0.8.9, `serde` |\n',
  };
}

const edit = (file, from, to) => (files) => {
  if (!files[file].includes(from)) throw new Error(`self-test fixture: "${from}" not found in ${file}`);
  files[file] = files[file].replace(from, to);
};
const append = (file, text) => (files) => {
  files[file] += text;
};

// [name, expected rule, mutation of the good repository]
const CASES = [
  ['crate pins its own version instead of the workspace one', 'A1', edit('apps/desktop/crates/aedst-common/Cargo.toml', 'serde = { workspace = true }', 'serde = "1.0.229"')],
  ['crate uses a dependency the workspace does not declare', 'A1', append('apps/desktop/crates/aedst-common/Cargo.toml', 'regex = { workspace = true }\n')],
  ['workspace dependency missing from approved-crates.txt', 'A2', edit('apps/desktop/approved-crates.txt', 'slint\n', '')],
  ['gateway dependency missing from approved-crates.txt', 'A2', edit('apps/gateway/approved-crates.txt', 'axum\n', '')],
  ['approved crate not named on the Library-First page', 'A3', edit('docs/content/library-first/gateway.md', '`axum`', 'axum')],
  ['stale approval (no longer declared)', 'A3', (files) => {
    files['apps/desktop/approved-crates.txt'] += 'anyhow\n';
    files['docs/content/library-first/desktop.md'] += '| Errors | `anyhow` |\n';
  }],
  ['banned crate declared and approved', 'A4', (files) => {
    files['apps/gateway/Cargo.toml'] = files['apps/gateway/Cargo.toml'].replace('axum = "0.8.9"\n', 'axum = "0.8.9"\nopenssl = "0.10"\n');
    files['apps/gateway/approved-crates.txt'] += 'openssl\n';
    files['docs/content/library-first/gateway.md'] += '| TLS | `openssl` |\n';
  }],
  ['shared crate version drift', 'V1', edit('apps/gateway/Cargo.toml', 'tokio = { version = "1.54.1"', 'tokio = { version = "1.53.0"')],
  ['shared dev-dependency version drift', 'V1', edit('apps/gateway/Cargo.toml', 'serde = "1.0.229"', 'serde = "1.0.200"')],
  ['lint level drift', 'L1', edit('apps/desktop/Cargo.toml', 'unwrap_used = "deny"', 'unwrap_used = "warn"')],
  ['lint missing on one side', 'L1', append('apps/gateway/Cargo.toml', 'print_stdout = "deny"\n')],
  ['toolchain drift', 'T1', edit('apps/gateway/rust-toolchain.toml', '1.100.0', '1.99.1')],
];

/** Runs `check` over the good repository and every seeded violation; returns true when the gate behaves. */
export function selfTest(check) {
  const tmp = mkdtempSync(path.join(os.tmpdir(), 'aedst-approved-crates-'));
  const write = (root, files) => {
    for (const [file, text] of Object.entries(files)) {
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(path.join(root, file), text);
    }
  };
  let failed = 0;
  try {
    write(path.join(tmp, 'good'), goodRepo());
    const clean = check(path.join(tmp, 'good')).violations;
    if (clean.length > 0) {
      failed += 1;
      console.log(`FAIL  good repository reported: ${clean.map((v) => `${v.rule} ${v.message}`).join('; ')}`);
    } else {
      console.log('ok    good repository passes');
    }
    CASES.forEach(([name, rule, mutate], index) => {
      const files = goodRepo();
      mutate(files);
      write(path.join(tmp, `bad-${index}`), files);
      const rules = check(path.join(tmp, `bad-${index}`)).violations.map((v) => v.rule);
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
