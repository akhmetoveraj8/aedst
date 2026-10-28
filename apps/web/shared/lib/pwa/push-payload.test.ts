import { describe, expect, it } from "vitest";

import {
  parsePushPayload,
  resolveNotificationUrl,
} from "@/shared/lib/pwa/push-payload";

describe("parsePushPayload", () => {
  it("reads the server's JSON payload", () => {
    expect(
      parsePushPayload(
        JSON.stringify({
          id: "n-1",
          title: "Task completed",
          body: "Write docs",
          link: "/tasks/t-1",
          kind: "NOTIFICATION_KIND_TASK_COMPLETED",
        }),
      ),
    ).toEqual({
      title: "Task completed",
      body: "Write docs",
      link: "/tasks/t-1",
      id: "n-1",
      kind: "NOTIFICATION_KIND_TASK_COMPLETED",
      tag: "n-1",
      lang: undefined,
    });
  });

  it("falls back to the inbox and survives plain text or junk", () => {
    expect(parsePushPayload(JSON.stringify({ title: "Hi" }))?.link).toBe(
      "/notifications",
    );
    expect(parsePushPayload("plain text")).toEqual({
      title: "plain text",
      link: "/notifications",
    });
    expect(parsePushPayload(JSON.stringify({ body: "no title" }))).toBeNull();
    expect(parsePushPayload("null")).toBeNull();
    expect(parsePushPayload(undefined)).toBeNull();
  });
});

describe("resolveNotificationUrl", () => {
  const origin = "https://app.example.com";

  it("opens relative in-app links on this origin", () => {
    expect(resolveNotificationUrl("/tasks/1?x=2", origin)).toBe(
      "https://app.example.com/tasks/1?x=2",
    );
  });

  it("never opens another site", () => {
    for (const link of [
      "https://evil.example",
      "//evil.example/path",
      "javascript:alert(1)",
      undefined,
    ]) {
      expect(resolveNotificationUrl(link, origin)).toBe(
        "https://app.example.com/notifications",
      );
    }
  });
});
