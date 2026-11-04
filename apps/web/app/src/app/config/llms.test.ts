import { describe, expect, it } from "vitest";
import { GET } from "@/app/llms.txt/route";
import { buildLlmsTxt } from "./llms";

describe("llms.txt", () => {
  it("follows the llmstxt.org shape and lists every locale of the public pages", () => {
    const body = buildLlmsTxt();

    expect(body.startsWith("# AEDST\n\n> ")).toBe(true);
    expect(body).toContain("## Pages");
    for (const locale of ["en", "ru", "tj", "uz", "ar"]) {
      expect(body).toContain(`(http://localhost:3000/${locale})`);
    }
    expect(body).toContain("(http://localhost:3000/sitemap.xml)");
    expect(body).not.toContain("/tasks");
  });

  it("is served as text/plain", async () => {
    const response = GET();

    expect(response.headers.get("content-type")).toContain("text/plain");
    expect(await response.text()).toBe(buildLlmsTxt());
  });
});
