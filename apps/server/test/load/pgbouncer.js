// k6 scenario for the PgBouncer (transaction pooling) deployment profile.
//
// What it is for: exercising the paths that break behind a transaction pooler,
// not finding the throughput knee (use api.js for that):
//
//   - authenticated writes that enqueue River jobs in the request transaction
//     (CreateTask / UpdateTask with a due date -> reminder job via InsertTx),
//   - prepared-statement-heavy reads: many distinct query shapes (filters x
//     sorts x pages, stats, point reads) so every pooled connection sees every
//     statement ("prepared statement ... does not exist" under pgx's default
//     QueryExecModeCacheStatement),
//   - idempotent retries (same Idempotency-Key twice -> advisory xact lock),
//   - read-your-writes across connections (a write followed at once by a read
//     must not be served from stale session state).
//
// Run through `task loadtest:pgbouncer` (compose profiles pgbouncer+loadtest,
// scaled server replicas behind nginx on :8088, a PgBouncer watcher alongside)
// or by hand against any pooled deployment:
//
//   k6 run -e BASE_URL=http://localhost:8088 -e RATE=60 -e DURATION=3m test/load/pgbouncer.js
//
// Env: BASE_URL (default http://localhost:8088), RATE (iterations/s, default
// 40), DURATION (hold, default 2m), TOKEN (bearer from the OIDC provider, required),
// PRE_VUS / MAX_VUS.
//
// Server rate limits must be off (compose loadtest profile does this): all
// VUs share one account.
//
// Pass/fail: thresholds below. A response whose body mentions a pooler/driver
// failure counts in `pooler_errors` and must stay at zero. Pool-side health
// (cl_waiting, maxwait, server connections, stuck jobs) is checked by
// scripts/loadtest-pgbouncer-watch.sh, which the task runs around this script.
import http from "k6/http";
import { check, fail, group } from "k6";
import { Counter } from "k6/metrics";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8088";
const RATE = parseInt(__ENV.RATE || "40", 10);
const DURATION = __ENV.DURATION || "2m";
const PRE_VUS = parseInt(__ENV.PRE_VUS || String(Math.max(20, RATE)), 10);
const MAX_VUS = parseInt(__ENV.MAX_VUS || String(Math.max(100, RATE * 4)), 10);

// Bodies of failed responses that point at the pooler or driver rather than
// at business logic. Connect hides internal causes, so the server log is the
// authoritative place (the watcher greps it too); these catch the ones that
// do leak (e.g. 'unavailable' with a pool message).
const POOLER_FAILURE = /prepared statement|pgbouncer|too many clients|no more connections|pool_timeout|lock held|SQLSTATE 08|conn closed|unexpected EOF/i;
const poolerErrors = new Counter("pooler_errors");
const serverErrors = new Counter("server_errors_5xx");

export const options = {
  scenarios: {
    pooled: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: PRE_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { target: RATE, duration: "30s" },
        { target: RATE, duration: DURATION },
        { target: 0, duration: "10s" },
      ],
    },
  },
  thresholds: {
    http_req_failed: ["rate<0.005"],
    checks: ["rate>0.99"],
    pooler_errors: ["count==0"],
    server_errors_5xx: ["count==0"],
    dropped_iterations: ["count==0"],
    // A transaction pooler adds a hop and a queue; budgets are a little looser
    // than api.js's direct-connection ones.
    "http_req_duration{rpc:CreateTask}": ["p(95)<400", "p(99)<800"],
    "http_req_duration{rpc:UpdateTask}": ["p(95)<400", "p(99)<800"],
    "http_req_duration{rpc:CompleteTask}": ["p(95)<400", "p(99)<800"],
    "http_req_duration{rpc:GetTask}": ["p(95)<200", "p(99)<400"],
    "http_req_duration{rpc:ListTasks}": ["p(95)<300", "p(99)<600"],
    "http_req_duration{rpc:GetTaskStats}": ["p(95)<300", "p(99)<600"],
  },
};

const HEADERS = { "Content-Type": "application/json", "Connect-Protocol-Version": "1", "X-Aedst-Client": "web/0.0.0-k6" };

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function rpc(path, body, token, extraHeaders) {
  const headers = Object.assign({}, HEADERS, extraHeaders || {});
  if (token) headers.Authorization = `Bearer ${token}`;
  const method = path.split("/").pop();
  const res = http.post(`${BASE_URL}/${path}`, JSON.stringify(body), { headers, tags: { rpc: method, name: method } });
  if (res.status >= 500) serverErrors.add(1);
  if (res.status >= 400 && POOLER_FAILURE.test(String(res.body))) poolerErrors.add(1);
  return res;
}

export function setup() {
  if (!__ENV.TOKEN) fail("pass -e TOKEN=<bearer>: an access token issued by the OIDC provider (the server has no sign-in RPCs, ADR-0019)");
  return { token: __ENV.TOKEN };
}

const STATUSES = [[], ["TASK_STATUS_TODO"], ["TASK_STATUS_IN_PROGRESS"], ["TASK_STATUS_DONE"], ["TASK_STATUS_TODO", "TASK_STATUS_IN_PROGRESS"]];
const PRIORITIES = [[], ["TASK_PRIORITY_HIGH"], ["TASK_PRIORITY_LOW", "TASK_PRIORITY_URGENT"]];
const SORTS = [
  { sortBy: "TASK_SORT_FIELD_CREATED_AT", sortDirection: "SORT_DIRECTION_DESC" },
  { sortBy: "TASK_SORT_FIELD_CREATED_AT", sortDirection: "SORT_DIRECTION_ASC" },
  { sortBy: "TASK_SORT_FIELD_DUE_DATE", sortDirection: "SORT_DIRECTION_ASC" },
  { sortBy: "TASK_SORT_FIELD_DUE_DATE", sortDirection: "SORT_DIRECTION_DESC" },
];
const SEARCHES = ["", "", "invoice", "deploy", "50%", "a_b"]; // LIKE metacharacters must stay literal
const pick = (a) => a[Math.floor(Math.random() * a.length)];

function inHours(h) {
  return new Date(Date.now() + h * 3600 * 1000).toISOString();
}

export default function (data) {
  const token = data.token;
  const key = uuid();

  let taskId;
  group("write: create with reminder (River InsertTx)", () => {
    const body = {
      title: `pool ${__VU}-${__ITER}`,
      description: "k6 pgbouncer profile",
      priority: pick(["TASK_PRIORITY_LOW", "TASK_PRIORITY_MEDIUM", "TASK_PRIORITY_HIGH"]),
      // A due date inside the reminder window makes the task enqueue a job in
      // the same transaction as the insert.
      dueDate: inHours(1 + Math.floor(Math.random() * 48)),
    };
    const created = rpc("aedst.tasks.v1.TasksService/CreateTask", body, token, { "Idempotency-Key": key });
    if (!check(created, { "CreateTask 200": (r) => r.status === 200 && !!r.json("task.id") })) return;
    taskId = created.json("task.id");

    // Same key again: must replay the stored response, not create a second task.
    const replay = rpc("aedst.tasks.v1.TasksService/CreateTask", body, token, { "Idempotency-Key": key });
    check(replay, { "CreateTask replay same id": (r) => r.status === 200 && r.json("task.id") === taskId });
  });
  if (!taskId) return;

  group("read: new statement shapes on every iteration", () => {
    // Read-your-write across pooled connections.
    const got = rpc("aedst.tasks.v1.TasksService/GetTask", { id: taskId }, token);
    check(got, { "GetTask sees own write": (r) => r.status === 200 && r.json("task.id") === taskId });

    const sort = pick(SORTS);
    const listed = rpc(
      "aedst.tasks.v1.TasksService/ListTasks",
      Object.assign({ statuses: pick(STATUSES), priorities: pick(PRIORITIES), search: pick(SEARCHES), pageSize: 10 + Math.floor(Math.random() * 30) }, sort),
      token,
    );
    const ok = check(listed, { "ListTasks 200": (r) => r.status === 200 });
    const next = ok ? listed.json("nextPageToken") : "";
    if (next) {
      const page2 = rpc("aedst.tasks.v1.TasksService/ListTasks", Object.assign({ pageSize: 10, pageToken: next, statuses: [], priorities: [], search: "" }, sort), token);
      // Cursor is bound to filters; a mismatch is a client error, a 5xx would be ours.
      check(page2, { "ListTasks page 2 not 5xx": (r) => r.status < 500 });
    }

    check(rpc("aedst.tasks.v1.TasksService/GetTaskStats", {}, token), { "GetTaskStats 200": (r) => r.status === 200 });
  });

  group("write: update (reschedules the reminder) then complete", () => {
    const updated = rpc(
      "aedst.tasks.v1.TasksService/UpdateTask",
      { id: taskId, dueDate: inHours(2 + Math.floor(Math.random() * 72)), updateMask: "dueDate" },
      token,
    );
    check(updated, { "UpdateTask 200": (r) => r.status === 200 });

    const done = rpc("aedst.tasks.v1.TasksService/CompleteTask", { id: taskId }, token);
    check(done, { "CompleteTask 200": (r) => r.status === 200 && r.json("task.status") === "TASK_STATUS_DONE" });
  });
}
