import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

describe("globals.css", () => {
  const css = readFileSync("src/app/styles/globals.css", "utf8");

  it("removes the default Tailwind palette so only tokens exist", () => {
    expect(css).toMatch(/@theme \{[^}]*--color-\*: initial;/);
  });

  it("maps the status tokens into the theme", () => {
    for (const name of ["success", "warning", "info", "destructive"]) {
      expect(css).toContain(`--color-${name}: var(--${name});`);
    }
  });
});
