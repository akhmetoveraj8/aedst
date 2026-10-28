import {
  create,
  type DescMethod,
  type DescService,
  fromJson,
  type JsonValue,
  toJson,
} from "@bufbuild/protobuf";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { AdminService } from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import { CapabilitiesService } from "@/shared/api/connect/generated/aedst/capabilities/v1/capabilities_pb";
import { MediaService } from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { NotificationsService } from "@/shared/api/connect/generated/aedst/notifications/v1/notifications_pb";
import { SearchService } from "@/shared/api/connect/generated/aedst/search/v1/search_pb";
import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
// The Playwright mock API (plain ESM, shared with e2e/mock-api/server.mjs).
import {
  control,
  services as mockServices,
  RpcError,
} from "../../../e2e/mock-api/handlers.mjs";

/**
 * Contract test: the in-memory mock that the whole Playwright suite runs
 * against must not drift from the real API contract (apps/server's protos,
 * via the generated descriptors). It checks that
 * 1. every mocked procedure exists in the descriptors, and every RPC in the
 *    descriptors is mocked;
 * 2. driving each procedure with a request built from the descriptor
 *    (protobuf JSON) returns a body that parses *strictly* as the
 *    procedure's response message — no unknown fields, right enum names,
 *    int64 as strings, valid timestamps;
 * 3. errors use real Connect code names.
 * With AEDST_CONTRACT_SERVER_URL set, it additionally checks that a real
 * apps/server serves every one of those procedures (see the last block).
 */

type Handler = (
  body: JsonValue,
  req: { headers: Record<string, string> },
) => JsonValue;
type MockServices = Record<string, Record<string, Handler>>;

const SERVICES: DescService[] = [
  TasksService,
  SearchService,
  NotificationsService,
  MediaService,
  AdminService,
  CapabilitiesService,
];

const CONNECT_CODES = new Set([
  "canceled",
  "unknown",
  "invalid_argument",
  "deadline_exceeded",
  "not_found",
  "already_exists",
  "permission_denied",
  "resource_exhausted",
  "failed_precondition",
  "aborted",
  "out_of_range",
  "unimplemented",
  "internal",
  "unavailable",
  "data_loss",
  "unauthenticated",
]);

const mocks = mockServices as unknown as MockServices;

function method(service: DescService, name: string): DescMethod {
  const found = service.methods.find((m) => m.name === name);
  if (!found) {
    throw new Error(`${service.typeName}/${name} is not in the descriptors`);
  }
  return found;
}

describe("mock API ↔ proto descriptors", () => {
  it("mocks exactly the services and procedures the protos define", () => {
    const fromProtos = SERVICES.flatMap((service) =>
      service.methods.map((m) => `${service.typeName}/${m.name}`),
    ).sort();
    const fromMock = Object.entries(mocks)
      .flatMap(([service, handlers]) =>
        Object.keys(handlers).map((name) => `${service}/${name}`),
      )
      .sort();
    expect(fromMock).toEqual(fromProtos);
  });
});

describe("mock API responses parse strictly as the declared messages", () => {
  const email = `contract-${Date.now()}@example.com`;
  let req: { headers: Record<string, string> };
  let taskId = "";
  let notificationId = "";
  let mediaId = "";
  let deviceId = "";
  let ownerId = "";

  /**
   * Builds the request through the descriptor (so it is valid protobuf JSON
   * by construction), sends it to the mock handler, and parses the answer as
   * the response message with unknown fields rejected.
   */
  function call(
    service: DescService,
    name: string,
    input: Record<string, unknown> = {},
  ) {
    const m = method(service, name);
    const body = toJson(m.input, fromJson(m.input, input as JsonValue));
    const handler = mocks[service.typeName]?.[m.name];
    if (!handler) {
      throw new Error(`${service.typeName}/${m.name} is not mocked`);
    }
    // Through JSON text, exactly as it travels on the wire.
    const output = JSON.parse(JSON.stringify(handler(body, req))) as JsonValue;
    return fromJson(m.output, output, { ignoreUnknownFields: false });
  }

  beforeAll(() => {
    const seeded = (
      control["/__test/seed"] as (b: object) => {
        userId: string;
        password: string;
      }
    )({ email, roles: ["user", "admin"], tasks: 3, notifications: 2 });
    ownerId = seeded.userId;
    req = { headers: {} };
    const { accessToken } = (
      control["/__test/token"] as (b: object) => { accessToken: string }
    )({ email });
    req = { headers: { authorization: `Bearer ${accessToken}` } };
  });

  afterAll(() => {
    (control["/__test/revoke-session"] as (b: object) => void)({ email });
  });

  it("TasksService", () => {
    const created = call(TasksService, "CreateTask", {
      title: "Contract task",
      priority: "TASK_PRIORITY_HIGH",
      dueDate: "2030-01-01T00:00:00Z",
    }) as unknown as { task?: { id: string } };
    taskId = created.task?.id ?? "";
    expect(taskId).toBeTruthy();
    call(TasksService, "GetTask", { id: taskId });
    call(TasksService, "ListTasks", {
      pageSize: 2,
      statuses: ["TASK_STATUS_TODO"],
      sortBy: "TASK_SORT_FIELD_DUE_DATE",
      sortDirection: "SORT_DIRECTION_ASC",
    });
    call(TasksService, "UpdateTask", {
      id: taskId,
      title: "Contract task (edited)",
      updateMask: "title",
    });
    call(TasksService, "CompleteTask", { id: taskId });
    call(TasksService, "ReopenTask", { id: taskId });
    call(TasksService, "GetTaskStats");
  });

  it("SearchService", () => {
    const result = call(SearchService, "Search", {
      query: "contract",
      pageSize: 5,
    }) as unknown as { hits: { title: string }[] };
    expect(result.hits[0]?.title).toContain("");
    call(SearchService, "Suggest", { prefix: "Seed", limit: 3 });
  });

  it("NotificationsService", () => {
    const list = call(NotificationsService, "ListNotifications", {
      pageSize: 10,
    }) as unknown as { notifications: { id: string }[] };
    notificationId = list.notifications[0]?.id ?? "";
    expect(notificationId).toBeTruthy();
    call(NotificationsService, "GetUnreadCount");
    call(NotificationsService, "MarkRead", { ids: [notificationId] });
    call(NotificationsService, "MarkAllRead");
    call(NotificationsService, "GetWebPushConfig");
    const device = call(NotificationsService, "RegisterPushDevice", {
      platform: "PUSH_PLATFORM_WEB_PUSH",
      webPush: { endpoint: "https://push.example/x", p256dh: "p", auth: "a" },
      deviceName: "Chrome · Linux",
    }) as unknown as { deviceId: string };
    deviceId = device.deviceId;
    call(NotificationsService, "UnregisterPushDevice", { deviceId });
    call(NotificationsService, "GetPreferences");
    call(NotificationsService, "UpdatePreferences", {
      preferences: { pushEnabled: true, taskCompleted: false },
    });
  });

  it("MediaService (presigned upload flow)", async () => {
    const upload = call(MediaService, "CreateUpload", {
      filename: "photo.jpg",
      contentType: "image/jpeg",
      sizeBytes: "3",
      taskId,
    }) as unknown as { media?: { id: string }; uploadUrl: string };
    mediaId = upload.media?.id ?? "";
    expect(upload.uploadUrl).toMatch(/^http/);
    const { storeObject } = await import("../../../e2e/mock-api/handlers.mjs");
    storeObject(mediaId, Buffer.from([1, 2, 3]));
    call(MediaService, "CompleteUpload", { id: mediaId });
    call(MediaService, "GetMedia", { id: mediaId });
    call(MediaService, "ListMedia", { taskId, kinds: ["MEDIA_KIND_IMAGE"] });
    call(MediaService, "DeleteMedia", { id: mediaId });
  });

  it("CapabilitiesService", () => {
    call(CapabilitiesService, "GetCapabilities");
  });

  it("AdminService", () => {
    call(AdminService, "GetOverview");
    call(AdminService, "ListUsers", { query: "contract", pageSize: 5 });
    call(AdminService, "ListTasks", { ownerId, pageSize: 5 });
    call(AdminService, "BroadcastNotification", {
      title: "Maintenance",
      link: "/tasks",
    });
    call(AdminService, "DeleteTask", { id: taskId, reason: "contract test" });
    call(AdminService, "ListAuditLog", { pageSize: 5 });
    call(TasksService, "DeleteTask", {
      id: (
        call(TasksService, "CreateTask", { title: "tmp" }) as unknown as {
          task?: { id: string };
        }
      ).task?.id,
    });
  });

  it("answers errors with real Connect codes", () => {
    const anonymous = { headers: {} };
    const handler = mocks["aedst.tasks.v1.TasksService"]?.GetTask;
    expect(() => handler?.({ id: "x" }, anonymous)).toThrow(RpcError);
    for (const [service, name, input] of [
      ["aedst.tasks.v1.TasksService", "GetTask", { id: "missing" }],
      ["aedst.media.v1.MediaService", "CreateUpload", {}],
    ] as const) {
      try {
        mocks[service]?.[name]?.(input, req);
        throw new Error("expected an RpcError");
      } catch (error) {
        expect(error).toBeInstanceOf(RpcError);
        expect(CONNECT_CODES.has((error as RpcError).code)).toBe(true);
      }
    }
  });

  it("builds every message type the mock touches from the descriptors", () => {
    for (const service of SERVICES) {
      for (const m of service.methods) {
        expect(() => create(m.input)).not.toThrow();
        expect(() => create(m.output)).not.toThrow();
      }
    }
  });
});

const realServer = process.env.AEDST_CONTRACT_SERVER_URL;

describe.skipIf(!realServer)(
  "real apps/server serves every mocked procedure",
  () => {
    it.each(
      Object.entries(mocks).flatMap(([service, handlers]) =>
        Object.keys(handlers).map((name) => `${service}/${name}`),
      ),
    )("%s", async (procedure) => {
      const response = await fetch(`${realServer}/${procedure}`, {
        method: "POST",
        headers: {
          "content-type": "application/json",
          "connect-protocol-version": "1",
        },
        body: "{}",
      });
      // Anything but "no such procedure" proves it exists: an empty body is
      // typically invalid_argument, and most procedures need a token.
      const body = (await response.json().catch(() => ({}))) as {
        code?: string;
      };
      expect(body.code).not.toBe("unimplemented");
      expect(response.status).not.toBe(404);
    });
  },
);
