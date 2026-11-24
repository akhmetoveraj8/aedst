import { describe, expect, it } from "vitest";
import { registerUrl, signInUrl } from "./app-links";

describe("app links", () => {
  it("point at NEXT_PUBLIC_APP_URL, never a hard-coded domain", () => {
    expect(signInUrl("ru")).toBe("http://localhost:3000/ru");
    expect(registerUrl()).toBe(
      "http://localhost:3000/api/auth/login?screen_hint=register",
    );
  });
});
