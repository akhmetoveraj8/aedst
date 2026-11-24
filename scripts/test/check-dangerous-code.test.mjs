// Negative self-test of scripts/check-dangerous-code.mjs: every rule must fire on its bad sample,
// stay silent on its safe sample, and honour a waiver. Run: `node --test scripts/test`.
import assert from "node:assert/strict";
import { test } from "node:test";
import { RULES } from "../dangerous-code/rules.mjs";
import { isScannable, scanText } from "../check-dangerous-code.mjs";

const BAD = {
  "js-eval": ["a.ts", "const x = eval(input);"],
  "js-shell-exec": ["a.ts", "exec(`rm ${dir}`);"],
  "js-shell-true": ["a.mjs", "spawn(cmd, args, { shell: true });"],
  "go-shell-exec": ["a.go", 'exec.Command("sh", "-c", cmd)'],
  "py-shell": ["a.py", "os.system(cmd)"],
  "web-inner-html": ["a.ts", "el.innerHTML = value;"],
  "react-dangerous-html": ["a.tsx", "<div dangerouslySetInnerHTML={{ __html: v }} />"],
  "go-sql-concat": ["a.go", 'q := fmt.Sprintf("SELECT * FROM t WHERE id = %s", id)'],
  "js-sql-template": ["a.ts", "db.query(`SELECT * FROM t WHERE id = ${id}`);"],
  "tls-verify-off": ["a.go", "&tls.Config{InsecureSkipVerify: true}"],
  "android-trust-all": ["a.kt", "settings.setJavaScriptEnabled(true)"],
  "apple-ats-off": ["a.swift", "NSAllowsArbitraryLoads"],
  "weak-hash": ["a.ts", "createHash('md5')"],
  "insecure-random": ["a.ts", "const sessionId = Math.random().toString(36);"],
  "jwt-unsafe": ["a.ts", "const claims = jwtDecode(token);"],
  "secret-literal": ["a.go", 'key := "AKIAABCDEFGHIJKLMNOP"'],
  "secret-assign": ["a.ts", 'const apiKey = "Zk3pQ9vL2mXw8RtY";'],
  "web-token-storage": ["a.ts", "localStorage.setItem('access_token', t);"],
  "cookie-flags-off": ["a.ts", "{ httpOnly: false }"],
  "cors-wildcard-credentials": ["a.ts", "res.setHeader('Access-Control-Allow-Origin', '*');"],
  "go-default-client": ["a.go", "resp, err := http.Get(url)"],
  "bind-all-interfaces": ["a.go", 'http.ListenAndServe("0.0.0.0:8080", h)'],
  "rust-unsafe": ["a.rs", "unsafe { ptr.read() }"],
  "ts-ignore": ["a.ts", "// @ts-ignore"],
};

const SAFE = [
  ["a.ts", "const m = /^(\\S+)\\s+(\\d+)$/.exec(line);"],
  ["a.ts", "execFile('git', ['status']);"],
  ["a.ts", "const id = crypto.randomUUID();"],
  ["a.go", "q := queries.GetTask(ctx, id)"],
  ["a.ts", "const label = 'access_token';"],
];

test("every rule has a bad sample", () => {
  const missing = RULES.filter((r) => !(r.id in BAD)).map((r) => r.id);
  assert.deepEqual(missing, [], "add a BAD sample for each new rule");
});

for (const [id, [file, line]] of Object.entries(BAD)) {
  test(`rule ${id} fires`, () => {
    const hits = scanText(file, line).map((h) => h.rule.id);
    assert.ok(hits.includes(id), `${id} did not fire on: ${line}`);
  });
  test(`rule ${id} accepts a waiver`, () => {
    assert.deepEqual(scanText(file, `${line} // security-ignore: reviewed, constant input`), []);
  });
}

test("safe code is not flagged", () => {
  for (const [file, line] of SAFE) assert.deepEqual(scanText(file, line), [], line);
});

test("a waiver without a reason does not count", () => {
  assert.ok(scanText("a.ts", "eval(x); // security-ignore:").length > 0);
});

test("tests, generated and docs paths are not scanned", () => {
  assert.equal(isScannable("apps/web/app/src/a.test.ts"), false);
  assert.equal(isScannable("apps/server/gen/x.go"), false);
  assert.equal(isScannable("docs/content/engineering/ai-safe-code.md"), false);
  assert.equal(isScannable("apps/web/app/src/a.ts"), true);
});
