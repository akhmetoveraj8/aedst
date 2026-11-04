import { describe, expect, it } from "vitest";

import {
  BroadcastNotificationRequestSchema,
  DeleteTaskRequestSchema,
} from "@/shared/api/connect/generated/aedst/admin/v1/admin_pb";
import {
  CreateTaskRequestSchema,
  TaskPriority,
} from "@/shared/api/connect/generated/aedst/tasks/v1/tasks_pb";

import { protovalidateResolver } from "./protovalidate-resolver";

type TaskValues = {
  title: string;
  description: string;
  priority: number;
  dueDate: string;
};

const options = { fields: {}, shouldUseNativeValidation: false };

const resolveTask = protovalidateResolver<
  typeof CreateTaskRequestSchema,
  TaskValues
>(CreateTaskRequestSchema, {
  toMessage: (values) => ({
    title: values.title.trim(),
    description: values.description,
    priority: values.priority,
  }),
});

const validTask: TaskValues = {
  title: "Write docs",
  description: "",
  priority: TaskPriority.MEDIUM,
  dueDate: "",
};

describe("protovalidateResolver", () => {
  it("accepts values that satisfy the proto rules", async () => {
    const result = await resolveTask(validTask, undefined, options);

    expect(result.errors).toEqual({});
    expect(result.values).toEqual(validTask);
  });

  it("maps string rules to the matching form field", async () => {
    const result = await resolveTask(
      { ...validTask, title: "   ", description: "x".repeat(4001) },
      undefined,
      options,
    );

    expect(result.values).toEqual({});
    expect(result.errors.title?.type).toBe("string.min_len");
    expect(result.errors.description?.type).toBe("string.max_len");
    expect(result.errors.priority).toBeUndefined();
  });

  it("enforces enum rules (not_in 0 / defined_only)", async () => {
    const unspecified = await resolveTask(
      { ...validTask, priority: TaskPriority.UNSPECIFIED },
      undefined,
      options,
    );
    const undefinedValue = await resolveTask(
      { ...validTask, priority: 99 },
      undefined,
      options,
    );

    expect(unspecified.errors.priority).toBeDefined();
    expect(undefinedValue.errors.priority).toBeDefined();
  });

  it("supports uuid and pattern rules and renames fields via fieldMap", async () => {
    const resolveBroadcast = protovalidateResolver<
      typeof BroadcastNotificationRequestSchema,
      { recipient: string; title: string; body: string; link: string }
    >(BroadcastNotificationRequestSchema, {
      toMessage: (values) => ({
        userId: values.recipient,
        title: values.title,
        body: values.body,
        link: values.link,
      }),
      fieldMap: { userId: "recipient" },
    });

    const ok = await resolveBroadcast(
      { recipient: "", title: "Hi", body: "", link: "/tasks" },
      undefined,
      { fields: {}, shouldUseNativeValidation: false },
    );
    expect(ok.errors).toEqual({});

    const bad = await resolveBroadcast(
      { recipient: "not-a-uuid", title: "Hi", body: "", link: "//evil" },
      undefined,
      { fields: {}, shouldUseNativeValidation: false },
    );
    expect(bad.errors.recipient).toBeDefined();
    expect(bad.errors.link).toBeDefined();
    expect(Object.keys(bad.errors)).not.toContain("userId");
  });
});

describe("protovalidateResolver omit", () => {
  it("ignores violations of fields the form does not collect", async () => {
    const resolve = protovalidateResolver<
      typeof DeleteTaskRequestSchema,
      { reason: string }
    >(DeleteTaskRequestSchema, {
      toMessage: (values) => ({ reason: values.reason }),
      omit: ["id"],
    });
    const options = { fields: {}, shouldUseNativeValidation: false };

    const ok = await resolve({ reason: "because" }, undefined, options);
    expect(ok.errors).toEqual({});
    expect(ok.values).toEqual({ reason: "because" });

    const bad = await resolve({ reason: "no" }, undefined, options);
    expect(Object.keys(bad.errors)).toEqual(["reason"]);
  });
});
