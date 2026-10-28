import { beforeEach, describe, expect, it, vi } from "vitest";

import { saveConsentAction } from "@/shared/lib/consent/consent-action";

const set = vi.fn();
let requestHeaders = new Headers();

vi.mock("next/headers", () => ({
  cookies: async () => ({ set }),
  headers: async () => requestHeaders,
}));

beforeEach(() => {
  set.mockReset();
  requestHeaders = new Headers();
});

describe("saveConsentAction", () => {
  it("stores a versioned record in a year-long first-party cookie the server can read", async () => {
    await saveConsentAction("granted");

    expect(set).toHaveBeenCalledOnce();
    const [name, value, options] = set.mock.calls[0] ?? [];
    expect(name).toBe("aedst_consent");
    expect(JSON.parse(value)).toEqual({
      version: 1,
      choice: "granted",
      at: expect.stringMatching(/^\d{4}-\d{2}-\d{2}T/),
    });
    expect(options).toEqual({
      httpOnly: false,
      secure: false,
      sameSite: "lax",
      path: "/",
      maxAge: 31_536_000,
    });
  });

  it("records a decline instead of a grant when the browser sends Sec-GPC", async () => {
    requestHeaders = new Headers({ "sec-gpc": "1" });

    await saveConsentAction("granted");

    expect(JSON.parse(set.mock.calls[0]?.[1]).choice).toBe("denied");
  });

  it.each(["yes", "", null, undefined, 1, { a: 1 }])(
    "ignores anything but granted/denied: %j",
    async (choice) => {
      await saveConsentAction(choice);

      expect(set).not.toHaveBeenCalled();
    },
  );
});
