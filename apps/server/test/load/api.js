// k6 load tests for the tasks + search RPCs over Connect's JSON protocol (no
// protobuf codegen needed in k6). One script, three scenarios:
//
//   SCENARIO=smoke   1 VU for 30s — the API works end to end (CI on main)
//   SCENARIO=load    open-model arrival rate RATE it/s held for DURATION
//   SCENARIO=stress  ramps the arrival rate to 5x RATE to find the knee
//
//   task load SCENARIO=load RATE=50 DURATION=5m
//   k6 run -e SCENARIO=stress -e BASE_URL=http://localhost:8080 test/load/api.js
//
// Auth: pass TOKEN, an access token from your OIDC provider (ZITADEL: the service
// user from deployments/zitadel/bootstrap.sh). Each
// iteration: CreateTask -> ListTasks -> Search -> Suggest -> CompleteTask.
// All VUs share one user, so run against a server with
// AEDST_API_RATE_LIMIT_PER_MINUTE=0 (the per-user limit exists to stop exactly
// this). Search results are eventually consistent (River event delivery ->
// projection), so the search checks only assert a well-formed response.
//
// Thresholds are the pass/fail SLOs: k6 exits non-zero when one is breached.
import http from "k6/http";
import { check, fail } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const SCENARIO = __ENV.SCENARIO || "smoke";
const RATE = parseInt(__ENV.RATE || "20", 10);
const DURATION = __ENV.DURATION || "2m";

const scenarios = {
  smoke: { executor: "constant-vus", vus: 1, duration: "30s" },
  load: {
    executor: "ramping-arrival-rate",
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: Math.max(10, RATE),
    maxVUs: Math.max(50, RATE * 4),
    stages: [
      { target: RATE, duration: "30s" },
      { target: RATE, duration: DURATION },
      { target: 0, duration: "10s" },
    ],
  },
  stress: {
    executor: "ramping-arrival-rate",
    startRate: 1,
    timeUnit: "1s",
    preAllocatedVUs: Math.max(20, RATE * 2),
    maxVUs: Math.max(200, RATE * 10),
    stages: [
      { target: RATE, duration: "1m" },
      { target: RATE * 2, duration: "2m" },
      { target: RATE * 5, duration: "2m" },
      { target: 0, duration: "30s" },
    ],
  },
};
if (!scenarios[SCENARIO]) {
  throw new Error(`unknown SCENARIO ${SCENARIO} (smoke|load|stress)`);
}

// Stress is expected to degrade at the top step; its thresholds are looser
// and abortOnFail stops the run once the system is clearly past its knee.
const strict = SCENARIO !== "stress";
export const options = {
  scenarios: { [SCENARIO]: scenarios[SCENARIO] },
  thresholds: {
    http_req_failed: [{ threshold: strict ? "rate<0.01" : "rate<0.05", abortOnFail: !strict }],
    checks: [strict ? "rate>0.99" : "rate>0.95"],
    "http_req_duration{rpc:CreateTask}": strict ? ["p(95)<300", "p(99)<600"] : ["p(95)<1500"],
    "http_req_duration{rpc:ListTasks}": strict ? ["p(95)<200", "p(99)<400"] : ["p(95)<1000"],
    "http_req_duration{rpc:Search}": strict ? ["p(95)<250", "p(99)<500"] : ["p(95)<1500"],
    "http_req_duration{rpc:Suggest}": strict ? ["p(95)<150", "p(99)<300"] : ["p(95)<1000"],
    "http_req_duration{rpc:CompleteTask}": strict ? ["p(95)<300", "p(99)<600"] : ["p(95)<1500"],
    ...(SCENARIO === "load" ? { dropped_iterations: ["count==0"] } : {}),
  },
};

const HEADERS = { "Content-Type": "application/json", "Connect-Protocol-Version": "1", "X-Aedst-Client": "web/0.0.0-k6" };

function rpc(path, body, token, extraHeaders) {
  const headers = Object.assign({}, HEADERS, extraHeaders || {});
  if (token) headers.Authorization = `Bearer ${token}`;
  const method = path.split("/").pop();
  return http.post(`${BASE_URL}/${path}`, JSON.stringify(body), { headers, tags: { rpc: method, name: method } });
}

export function setup() {
  if (!__ENV.TOKEN) fail("pass -e TOKEN=<bearer>: an access token issued by the OIDC provider (the server has no sign-in RPCs, ADR-0019)");
  return { token: __ENV.TOKEN };
}

const WORDS = ["invoice", "rent", "groceries", "deploy", "review", "dentist", "taxes", "garden", "backup", "report"];

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

export default function (data) {
  const word = WORDS[Math.floor(Math.random() * WORDS.length)];

  const created = rpc(
    "aedst.tasks.v1.TasksService/CreateTask",
    { title: `${word} ${__VU}-${__ITER}`, description: `k6 ${word} task`, priority: "TASK_PRIORITY_MEDIUM" },
    data.token,
    { "Idempotency-Key": uuid() },
  );
  const ok = check(created, { "CreateTask 200": (r) => r.status === 200 && !!r.json("task.id") });
  if (!ok) return;
  const taskId = created.json("task.id");

  const listed = rpc("aedst.tasks.v1.TasksService/ListTasks", { pageSize: 20 }, data.token);
  check(listed, { "ListTasks 200": (r) => r.status === 200 && Array.isArray(r.json("tasks")) });

  const searched = rpc("aedst.search.v1.SearchService/Search", { query: word, pageSize: 10 }, data.token);
  check(searched, { "Search 200": (r) => r.status === 200 });

  const suggested = rpc("aedst.search.v1.SearchService/Suggest", { prefix: word.slice(0, 3), limit: 5 }, data.token);
  check(suggested, { "Suggest 200": (r) => r.status === 200 });

  const completed = rpc("aedst.tasks.v1.TasksService/CompleteTask", { id: taskId }, data.token);
  check(completed, { "CompleteTask 200": (r) => r.status === 200 && r.json("task.status") === "TASK_STATUS_DONE" });
}
