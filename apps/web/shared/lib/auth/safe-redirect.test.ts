import { describe, expect, it } from "vitest";

import {
  safeInAppPath,
  safeRedirectPath,
} from "@/shared/lib/auth/safe-redirect";

describe("safeRedirectPath", () => {
  it.each([
    "/tasks",
    "/tasks/123",
    "/tasks?status=done&q=a%20b",
    "/tasks#section",
    "/",
  ])("keeps the same-origin path %j", (path) => {
    expect(safeRedirectPath(path)).toBe(path);
  });

  it.each([
    "https://evil.example/tasks",
    "http://evil.example",
    "//evil.example",
    "//evil.example/tasks",
    "/\\evil.example",
    "\\\\evil.example",
    "javascript:alert(1)",
    "tasks",
    "",
    "/tasks\r\nSet-Cookie: x=1",
    "/tasks\u0000",
  ])("rejects the unsafe target %j", (target) => {
    expect(safeRedirectPath(target)).toBe("/tasks");
  });

  it("falls back for null/undefined and honours a custom fallback", () => {
    expect(safeRedirectPath(null)).toBe("/tasks");
    expect(safeRedirectPath(undefined, "/home")).toBe("/home");
    expect(safeRedirectPath("//x", "/home")).toBe("/home");
  });
});

describe("safeInAppPath", () => {
  it("returns the path or null (no fallback), for links that came from data", () => {
    expect(safeInAppPath("/tasks/1?x=1")).toBe("/tasks/1?x=1");
    expect(safeInAppPath("//evil.example")).toBeNull();
    expect(safeInAppPath("")).toBeNull();
    expect(safeInAppPath(null)).toBeNull();
    expect(safeInAppPath(undefined)).toBeNull();
  });
});
