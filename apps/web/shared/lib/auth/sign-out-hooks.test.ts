import { describe, expect, it, vi } from "vitest";

import {
  registerBeforeSignOut,
  runBeforeSignOut,
} from "@/shared/lib/auth/sign-out-hooks";

describe("sign-out hooks", () => {
  it("runs registered hooks, survives failures, and can be unregistered", async () => {
    const ok = vi.fn();
    const failing = vi.fn().mockRejectedValue(new Error("offline"));
    const offOk = registerBeforeSignOut(ok);
    const offFailing = registerBeforeSignOut(failing);

    await runBeforeSignOut();
    expect(ok).toHaveBeenCalledOnce();
    expect(failing).toHaveBeenCalledOnce();

    offOk();
    offFailing();
    await runBeforeSignOut();
    expect(ok).toHaveBeenCalledOnce();
  });

  it("never blocks sign-out longer than the timeout", async () => {
    vi.useFakeTimers();
    const off = registerBeforeSignOut(() => new Promise(() => {}));
    const done = runBeforeSignOut(100);
    await vi.advanceTimersByTimeAsync(100);
    await expect(done).resolves.toBeUndefined();
    off();
    vi.useRealTimers();
  });
});
