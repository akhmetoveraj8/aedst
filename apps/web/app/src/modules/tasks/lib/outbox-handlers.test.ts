import { Code, ConnectError, createRouterTransport } from "@connectrpc/connect";
import { describe, expect, it } from "vitest";

import { createTaskOutboxHandlers } from "@/modules/tasks/lib/outbox-handlers";
import { manifest } from "@/modules/tasks/manifest";
import { TasksService } from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";
import type { OutboxHandler } from "@/shared/lib/outbox/types";
import contract from "../../../../../../../docs/contract/behavior/offline-outbox.json";

function handlersFor(impl: {
  createTask?: (key: string | null, title: string) => void;
  updateTask?: (key: string | null, id: string, paths: string[]) => void;
  fail?: Code;
}) {
  const transport = createRouterTransport(({ service }) => {
    service(TasksService, {
      createTask(request, context) {
        if (impl.fail !== undefined) {
          throw new ConnectError("nope", impl.fail);
        }
        impl.createTask?.(
          context.requestHeader.get("idempotency-key"),
          request.title,
        );
        return {};
      },
      updateTask(request, context) {
        impl.updateTask?.(
          context.requestHeader.get("idempotency-key"),
          request.id,
          request.updateMask?.paths ?? [],
        );
        return {};
      },
    });
  });
  return new Map<string, OutboxHandler>(
    createTaskOutboxHandlers(transport).map((handler) => [
      handler.type,
      handler,
    ]),
  );
}

const create = JSON.stringify({
  title: "Buy milk",
  description: "",
  priority: 2,
});

describe("tasks outbox handlers", () => {
  it("cover exactly the types the manifest declares and the contract knows", () => {
    const types = [...handlersFor({}).keys()].sort();
    expect(types).toEqual([...(manifest.outbox ?? [])].sort());
    expect(types).toEqual([...contract.knownTypes].sort());
  });

  it("sends task.create with the item id as Idempotency-Key", async () => {
    const seen: Array<[string | null, string]> = [];
    const handlers = handlersFor({ createTask: (k, t) => seen.push([k, t]) });

    const outcome = await handlers
      .get("task.create")
      ?.deliver({ idempotencyKey: "item-1", payload: create });

    expect(outcome).toBe("ok");
    expect(seen).toEqual([["item-1", "Buy milk"]]);
  });

  it("sends task.update with a field mask and the key", async () => {
    const seen: Array<[string | null, string, string[]]> = [];
    const handlers = handlersFor({
      updateTask: (k, i, p) => seen.push([k, i, p]),
    });

    const outcome = await handlers.get("task.update")?.deliver({
      idempotencyKey: "item-2",
      payload: JSON.stringify({ ...JSON.parse(create), taskId: "t-1" }),
    });

    expect(outcome).toBe("ok");
    expect(seen).toEqual([
      ["item-2", "t-1", ["title", "description", "priority", "due_date"]],
    ]);
  });

  it.each([
    [Code.Unavailable, "retryable"],
    [Code.DeadlineExceeded, "retryable"],
    [Code.ResourceExhausted, "retryable"],
    [Code.Unauthenticated, "retryable"],
    [Code.InvalidArgument, "permanent"],
    [Code.PermissionDenied, "permanent"],
    [Code.NotFound, "permanent"],
  ])("classifies Connect code %s as %s", async (code, expected) => {
    const outcome = await handlersFor({ fail: code })
      .get("task.create")
      ?.deliver({ idempotencyKey: "k", payload: create });
    expect(outcome).toBe(expected);
  });

  it("parks a malformed payload instead of sending it", async () => {
    const handlers = handlersFor({});
    for (const payload of ["not json", "{}", JSON.stringify({ title: 1 })]) {
      expect(
        await handlers
          .get("task.create")
          ?.deliver({ idempotencyKey: "k", payload }),
      ).toBe("permanent");
    }
    // An update needs a taskId.
    expect(
      await handlers
        .get("task.update")
        ?.deliver({ idempotencyKey: "k", payload: create }),
    ).toBe("permanent");
  });
});
