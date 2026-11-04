import { describe, expect, it } from "vitest";

import { bufferEarlyErrors } from "@/app/config/sentry/early-errors";

const event = (type: string, fields: Record<string, unknown>) =>
  Object.assign(new Event(type), fields);

describe("bufferEarlyErrors", () => {
  it("keeps uncaught errors and rejections until drained, then stops listening", () => {
    const target = new EventTarget();
    const drain = bufferEarlyErrors(target as unknown as Window);
    const thrown = new Error("boom");

    target.dispatchEvent(event("error", { error: thrown }));
    target.dispatchEvent(event("error", { message: "Script error." }));
    target.dispatchEvent(event("unhandledrejection", { reason: "nope" }));

    expect(drain()).toEqual([thrown, "Script error.", "nope"]);
    target.dispatchEvent(event("error", { error: new Error("late") }));
    expect(drain()).toEqual([]);
  });
});
