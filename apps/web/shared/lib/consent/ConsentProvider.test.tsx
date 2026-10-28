import { renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";

import {
  ConsentProvider,
  useConsent,
} from "@/shared/lib/consent/ConsentProvider";
import { saveConsentAction } from "@/shared/lib/consent/consent-action";
import { parseConsent } from "@/shared/lib/consent/consent-cookie";

vi.mock("@/shared/lib/consent/consent-action", () => ({
  saveConsentAction: vi.fn(),
}));

describe("parseConsent", () => {
  it("accepts only the two recorded answers", () => {
    expect(parseConsent("granted")).toBe("granted");
    expect(parseConsent("denied")).toBe("denied");
    expect(parseConsent("yes")).toBe("unknown");
    expect(parseConsent(undefined)).toBe("unknown");
  });
});

describe("ConsentProvider", () => {
  const wrap =
    (initial: "unknown" | "granted" | "denied") =>
    ({ children }: { children: React.ReactNode }) => (
      <ConsentProvider initial={initial}>{children}</ConsentProvider>
    );

  it("starts from the server-provided answer — no flash for returning visitors", () => {
    const { result } = renderHook(() => useConsent(), {
      wrapper: wrap("granted"),
    });

    expect(result.current.consent).toBe("granted");
  });

  it("applies a choice immediately and persists it through the server action", async () => {
    vi.mocked(saveConsentAction).mockResolvedValue(undefined);
    const { result } = renderHook(() => useConsent(), {
      wrapper: wrap("unknown"),
    });

    result.current.grant();

    await waitFor(() => expect(result.current.consent).toBe("granted"));
    expect(saveConsentAction).toHaveBeenCalledWith("granted");

    result.current.deny();
    await waitFor(() => expect(result.current.consent).toBe("denied"));
    expect(saveConsentAction).toHaveBeenLastCalledWith("denied");
  });

  it("keeps the choice for this page view even when the cookie write fails", async () => {
    vi.mocked(saveConsentAction).mockRejectedValue(new Error("offline"));
    const { result } = renderHook(() => useConsent(), {
      wrapper: wrap("unknown"),
    });

    result.current.deny();

    await waitFor(() => expect(result.current.consent).toBe("denied"));
  });

  it("ignores a grant, and starts denied, under Global Privacy Control", () => {
    vi.mocked(saveConsentAction).mockClear();
    const { result } = renderHook(() => useConsent(), {
      wrapper: ({ children }) => (
        <ConsentProvider initial="granted" privacySignal>
          {children}
        </ConsentProvider>
      ),
    });

    expect(result.current.consent).toBe("denied");
    result.current.grant();
    expect(result.current.consent).toBe("denied");
    expect(saveConsentAction).not.toHaveBeenCalled();
  });

  it("throws outside the provider", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    expect(() => renderHook(() => useConsent())).toThrow(/ConsentProvider/);
    spy.mockRestore();
  });
});
