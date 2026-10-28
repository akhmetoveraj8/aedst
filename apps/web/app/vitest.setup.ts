import "@testing-library/jest-dom/vitest";
import { cleanup, configure } from "@testing-library/react";
import { afterEach, expect, vi } from "vitest";
import { routerMock } from "./src/test/mocks/navigation";
import { backend } from "./src/test/mocks/transport";

// DOM setup for the `browser` project (real Chromium). Node-side tests use
// vitest.setup.node.ts instead.

// findBy*/waitFor default to 1 s, which a loaded CI runner (coverage, many
// workers) can exceed for real Connect round trips through the in-memory
// router transport.
configure({ asyncUtilTimeout: 3_000 });

// next-intl's navigation needs a mounted App Router; swap it for a spy-able stub.
vi.mock("@/shared/i18n/navigation", async () => {
  return await import("./src/test/mocks/navigation");
});

afterEach(() => {
  cleanup();
  for (const fn of Object.values(routerMock)) {
    fn.mockReset();
  }
  window.localStorage.clear();

  // The in-memory backend answers undeclared RPCs with `unimplemented`; make
  // that a test failure instead of a silent error state in the component.
  const unhandled = [...backend.unhandled];
  backend.reset();
  expect(unhandled, "RPCs called without a declared mock").toEqual([]);
});
