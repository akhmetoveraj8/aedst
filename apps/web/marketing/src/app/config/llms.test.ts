import { describe, expect, it } from "vitest";
import { buildLlmsTxt } from "@/app/config/llms";
import { publicRoutes } from "@/app/config/public-routes";
import { locales } from "@/shared/i18n/locales";

describe("buildLlmsTxt", () => {
  const body = buildLlmsTxt();

  it("follows the llms.txt shape: H1, blockquote, H2 sections", () => {
    expect(body).toMatch(/^# AEDST\n\n> /);
    expect(body).toContain("\n## Pages\n");
  });

  it("links every public page in every locale", () => {
    expect(body.match(/^- \[.*\]\(http/gm)).toHaveLength(
      publicRoutes.length * locales.length + 2,
    );
    expect(body).toContain("http://localhost:3002/tj/privacy");
  });
});
