import { describe, expect, it } from "vitest";

import {
  classifySession,
  decideRoute,
  splitLocale,
} from "@/app/config/security/route-guard";

function jwt(exp: number): string {
  const encode = (value: object) =>
    btoa(JSON.stringify(value))
      .replace(/\+/g, "-")
      .replace(/\//g, "_")
      .replace(/=+$/, "");
  return `${encode({ alg: "none" })}.${encode({ sub: "u", exp })}.sig`;
}

const NOW = 1_700_000_000_000;
const fresh = jwt(NOW / 1000 + 600);
const stale = jwt(NOW / 1000 - 600);

describe("classifySession", () => {
  it("is active with an unexpired access token", () => {
    expect(
      classifySession({ accessToken: fresh, refreshToken: "r", nowMs: NOW }),
    ).toBe("active");
  });

  it("is refreshable when the access token is missing or expired but a refresh token exists", () => {
    expect(
      classifySession({
        accessToken: undefined,
        refreshToken: "r",
        nowMs: NOW,
      }),
    ).toBe("refreshable");
    expect(
      classifySession({ accessToken: stale, refreshToken: "r", nowMs: NOW }),
    ).toBe("refreshable");
  });

  it("is anonymous with no usable tokens", () => {
    expect(
      classifySession({
        accessToken: undefined,
        refreshToken: undefined,
        nowMs: NOW,
      }),
    ).toBe("anonymous");
    expect(
      classifySession({
        accessToken: stale,
        refreshToken: undefined,
        nowMs: NOW,
      }),
    ).toBe("anonymous");
  });
});

describe("splitLocale", () => {
  it("splits a supported locale prefix from the rest", () => {
    expect(splitLocale("/ru/tasks/1")).toEqual({
      locale: "ru",
      rest: "/tasks/1",
    });
    expect(splitLocale("/en")).toEqual({ locale: "en", rest: "" });
  });

  it("returns null without a supported locale prefix", () => {
    expect(splitLocale("/tasks")).toBeNull();
    expect(splitLocale("/fr/tasks")).toBeNull();
    expect(splitLocale("/english")).toBeNull();
  });
});

describe("decideRoute", () => {
  it("sends an anonymous visitor from a protected page to login, remembering the destination", () => {
    expect(
      decideRoute({
        pathname: "/en/tasks",
        search: "?status=done&q=a",
        session: "anonymous",
      }),
    ).toEqual({
      type: "redirect",
      location: `/en?next=${encodeURIComponent("/tasks?status=done&q=a")}`,
    });
  });

  it("guards nested protected routes in every locale", () => {
    const decision = decideRoute({
      pathname: "/ar/tasks/new",
      search: "",
      session: "anonymous",
    });
    expect(decision).toEqual({
      type: "redirect",
      location: `/ar?next=${encodeURIComponent("/tasks/new")}`,
    });
  });

  it("lets a signed-in or refreshable session through to protected pages", () => {
    for (const session of ["active", "refreshable"] as const) {
      expect(
        decideRoute({ pathname: "/en/tasks", search: "", session }),
      ).toEqual({ type: "next" });
    }
  });

  it("guards the search and notifications areas like tasks", () => {
    for (const path of ["/search", "/notifications/preferences"]) {
      expect(
        decideRoute({
          pathname: `/en${path}`,
          search: "",
          session: "anonymous",
        }),
      ).toEqual({
        type: "redirect",
        location: `/en?next=${encodeURIComponent(path)}`,
      });
    }
  });

  it("skips the login page for a signed-in visitor, honouring a safe next", () => {
    expect(
      decideRoute({
        pathname: "/en",
        search: `?next=${encodeURIComponent("/tasks?status=done")}`,
        session: "active",
      }),
    ).toEqual({ type: "redirect", location: "/en/tasks?status=done" });
  });

  it("defaults the post-login destination to /tasks", () => {
    expect(
      decideRoute({ pathname: "/uz", search: "", session: "active" }),
    ).toEqual({ type: "redirect", location: "/uz/tasks" });
  });

  it("never redirects off-site through next", () => {
    expect(
      decideRoute({
        pathname: "/en",
        search: `?next=${encodeURIComponent("//evil.example")}`,
        session: "active",
      }),
    ).toEqual({ type: "redirect", location: "/en/tasks" });
  });

  it("leaves the login page alone for anonymous visitors and unrelated routes alone", () => {
    expect(
      decideRoute({ pathname: "/en", search: "", session: "anonymous" }),
    ).toEqual({ type: "next" });
    expect(
      decideRoute({ pathname: "/en/about", search: "", session: "anonymous" }),
    ).toEqual({ type: "next" });
    expect(
      decideRoute({ pathname: "/unknown", search: "", session: "anonymous" }),
    ).toEqual({ type: "next" });
  });

  it("does not treat lookalike paths as protected", () => {
    expect(
      decideRoute({
        pathname: "/en/tasksfoo",
        search: "",
        session: "anonymous",
      }),
    ).toEqual({ type: "next" });
  });
});

describe("decideRoute with a module switched off by the server", () => {
  it("sends a signed-in user to the forbidden page, a signed-out one to login first", () => {
    const base = {
      pathname: "/en/search/x",
      search: "",
      disabledPrefixes: ["/search"],
    };
    expect(decideRoute({ ...base, session: "active" })).toEqual({
      type: "redirect",
      location: "/en/forbidden",
    });
    expect(decideRoute({ ...base, session: "anonymous" })).toMatchObject({
      type: "redirect",
      location: expect.stringContaining("/en?next="),
    });
    expect(
      decideRoute({ ...base, pathname: "/en/tasks", session: "active" }),
    ).toEqual({ type: "next" });
  });
});
