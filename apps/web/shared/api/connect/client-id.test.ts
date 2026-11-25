// @vitest-environment node
import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

import { CLIENT_ID, CLIENT_VERSION } from "@/shared/api/connect/client-id";

describe("CLIENT_VERSION", () => {
  it("matches the version in apps/web/shared/package.json", () => {
    const manifest: unknown = JSON.parse(
      readFileSync(new URL("../../package.json", import.meta.url), "utf8"),
    );
    expect(manifest).toMatchObject({ version: CLIENT_VERSION });
    expect(CLIENT_ID).toBe(`web/${CLIENT_VERSION}`);
  });
});
