import { describe, expect, it } from "vitest";
import { renderOfflinePage } from "@/app/config/pwa/offline-page";
import { GET } from "@/app/offline/[locale]/route";

describe("offline fallback page", () => {
  it("is localized, direction-aware and script-free", () => {
    const html = renderOfflinePage("ar");
    expect(html).toContain('lang="ar" dir="rtl"');
    expect(html).toContain("لا يوجد اتصال");
    expect(html).not.toMatch(/<script/i);
  });

  it("uses the real BCP 47 tag for Tajik", () => {
    expect(renderOfflinePage("tj")).toContain('lang="tg"');
  });

  it("serves with a locked-down CSP and 404s unknown locales", async () => {
    const ok = await GET(new Request("http://x/offline/en"), {
      params: Promise.resolve({ locale: "en" }),
    });
    expect(ok.headers.get("content-security-policy")).toContain(
      "default-src 'none'",
    );
    const missing = await GET(new Request("http://x/offline/xx"), {
      params: Promise.resolve({ locale: "xx" }),
    });
    expect(missing.status).toBe(404);
  });
});
