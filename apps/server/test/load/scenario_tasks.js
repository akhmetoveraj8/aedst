// k6 scenario: drive an open-model (arrival-rate) workload of
// CreateTask -> ListTasks (page 1, then page 2 via next_page_token) -> CompleteTask
// over ConnectRPC's JSON protocol (no protobuf codegen needed in k6).
//
//   task test:load:tasks RATE=50 DURATION=5m
//   k6 run -e BASE_URL=http://localhost:8080 -e RATE=100 -e DURATION=2m test/load/scenario_tasks.js
//
// Env: BASE_URL (default http://localhost:8080), RATE (iterations/s at peak, default 20),
//      DURATION (hold time at peak, default 1m), PRE_VUS / MAX_VUS (executor VU pool).
//
// Notes:
// - All VUs share ONE identity: the TOKEN bearer from your OIDC provider (required; the
//   server has no sign-in RPCs, ADR-0019). Keep total runtime below the token's lifetime.
// - Request/response shapes: api/proto/aedst/tasks/v1/*.proto, api/bruno/.
import http from "k6/http";
import { check, group, fail } from "k6";

const BASE_URL = __ENV.BASE_URL || "http://localhost:8080";
const RATE = parseInt(__ENV.RATE || "20", 10);
const DURATION = __ENV.DURATION || "1m";
const PRE_VUS = parseInt(__ENV.PRE_VUS || String(Math.max(10, RATE)), 10);
const MAX_VUS = parseInt(__ENV.MAX_VUS || String(Math.max(50, RATE * 4)), 10);

export const options = {
  scenarios: {
    tasks: {
      executor: "ramping-arrival-rate",
      startRate: 1,
      timeUnit: "1s",
      preAllocatedVUs: PRE_VUS,
      maxVUs: MAX_VUS,
      stages: [
        { target: RATE, duration: "30s" }, // ramp up
        { target: RATE, duration: DURATION }, // hold
        { target: 0, duration: "10s" }, // ramp down
      ],
    },
  },
  thresholds: {
    // Overall.
    http_req_failed: ["rate<0.01"],
    dropped_iterations: ["count==0"], // arrival rate not sustained = capacity reached
    // Per request group (tag `rpc`). Writes are allowed to be slower than reads.
    "http_req_duration{rpc:CreateTask}": ["p(95)<300", "p(99)<600"],
    "http_req_duration{rpc:ListTasks}": ["p(95)<200", "p(99)<400"],
    "http_req_duration{rpc:CompleteTask}": ["p(95)<300", "p(99)<600"],
    "http_req_failed{rpc:CreateTask}": ["rate<0.01"],
    "http_req_failed{rpc:ListTasks}": ["rate<0.01"],
    "http_req_failed{rpc:CompleteTask}": ["rate<0.01"],
    "checks{rpc:CreateTask}": ["rate>0.99"],
    "checks{rpc:ListTasks}": ["rate>0.99"],
    "checks{rpc:CompleteTask}": ["rate>0.99"],
  },
};

const JSON_HEADERS = { "Content-Type": "application/json", "Connect-Protocol-Version": "1" };

function uuid() {
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    const r = (Math.random() * 16) | 0;
    return (c === "x" ? r : (r & 0x3) | 0x8).toString(16);
  });
}

function rpc(service, method, body, token, name, extraHeaders) {
  const headers = Object.assign({}, JSON_HEADERS, extraHeaders || {});
  if (token) headers.Authorization = `Bearer ${token}`;
  return http.post(`${BASE_URL}/${service}/${method}`, JSON.stringify(body), {
    headers,
    // `rpc` tag drives the per-group thresholds; `name` keeps URL cardinality at 1.
    tags: { rpc: method, name },
  });
}

export function setup() {
  if (!__ENV.TOKEN) {
    fail("pass -e TOKEN=<bearer>: an access token issued by the OIDC provider");
  }
  return { accessToken: __ENV.TOKEN };
}

export default function (data) {
  const token = data.accessToken;
  const svc = "aedst.tasks.v1.TasksService";
  let taskId = "";

  group("CreateTask", () => {
    const res = rpc(
      svc,
      "CreateTask",
      {
        title: `k6 task ${__VU}-${__ITER}`,
        description: "created by scenario_tasks.js",
        priority: "TASK_PRIORITY_MEDIUM",
      },
      token,
      "CreateTask",
      { "Idempotency-Key": uuid() },
    );
    const ok = check(
      res,
      {
        "create: 200": (r) => r.status === 200,
        "create: has id": (r) => !!r.json("task.id"),
      },
      { rpc: "CreateTask" },
    );
    if (ok) taskId = res.json("task.id");
  });
  if (!taskId) return;

  group("ListTasks", () => {
    const first = rpc(
      svc,
      "ListTasks",
      { pageSize: 20, sortBy: "TASK_SORT_FIELD_CREATED_AT", sortDirection: "SORT_DIRECTION_DESC" },
      token,
      "ListTasks",
    );
    check(first, { "list: 200": (r) => r.status === 200 }, { rpc: "ListTasks" });
    const next = first.status === 200 ? first.json("nextPageToken") : "";
    if (next) {
      const second = rpc(
        svc,
        "ListTasks",
        {
          pageSize: 20,
          sortBy: "TASK_SORT_FIELD_CREATED_AT",
          sortDirection: "SORT_DIRECTION_DESC",
          pageToken: next,
        },
        token,
        "ListTasks",
      );
      check(second, { "list page 2: 200": (r) => r.status === 200 }, { rpc: "ListTasks" });
    }
  });

  group("CompleteTask", () => {
    const res = rpc(svc, "CompleteTask", { id: taskId }, token, "CompleteTask");
    check(
      res,
      {
        "complete: 200": (r) => r.status === 200,
        "complete: status DONE": (r) => r.json("task.status") === "TASK_STATUS_DONE",
      },
      { rpc: "CompleteTask" },
    );
  });
}
