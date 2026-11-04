import { describe, expect, it } from "vitest";

import { appIcons } from "@/app/config/icons";

describe("appIcons", () => {
  it("links an apple-touch-icon that the icon route actually serves", () => {
    expect(appIcons.apple).toEqual([
      expect.objectContaining({
        url: "/icons/apple-touch-icon.png",
        sizes: "180x180",
      }),
    ]);
  });
});
