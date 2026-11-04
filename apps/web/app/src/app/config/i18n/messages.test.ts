import { describe, expect, it } from "vitest";

import { loadMessages } from "@/app/config/i18n/messages";
import {
  i18nNamespacesForRoutes,
  publicI18nNamespaces,
} from "@/app/config/modules/registry";
import { locales } from "@/shared/i18n/locales";

const bytes = (value: unknown) => JSON.stringify(value).length;

describe("loadMessages", () => {
  it("loads every module catalog by default (server components)", async () => {
    const all = await loadMessages("en");
    expect(Object.keys(all).sort()).toEqual([
      "auth",
      "common",
      "media",
      "notifications",
      "search",
      "tasks",
    ]);
  });

  it("loads common plus only the requested namespaces", async () => {
    const subset = await loadMessages("en", ["tasks", "unknown"]);
    expect(Object.keys(subset).sort()).toEqual(["common", "tasks"]);
    expect(Object.keys(await loadMessages("en", []))).toEqual(["common"]);
  });

  it("keeps the HTML-bound subsets far smaller than the full catalog, in every locale", async () => {
    for (const locale of locales) {
      const full = bytes(await loadMessages(locale));
      // Sign-in page: common + the public-route module(s).
      const signIn = bytes(await loadMessages(locale, publicI18nNamespaces));
      // Heaviest signed-in route: shell widgets + the route's own module.
      const tasksRoute = bytes(
        await loadMessages(locale, [
          ...publicI18nNamespaces,
          ...i18nNamespacesForRoutes(["/search", "/notifications", "/tasks"]),
          "media",
        ]),
      );
      expect(signIn, locale).toBeLessThan(full * 0.5);
      // With admin moved to its own project, the heaviest route can equal the whole catalog.
      expect(tasksRoute, locale).toBeLessThanOrEqual(full);
    }
  }, 60_000);
});

describe("route namespaces", () => {
  it("resolves a route to the owning module's namespaces (longest prefix)", () => {
    expect(i18nNamespacesForRoutes(["/tasks"])).toEqual(["tasks"]);
    expect(i18nNamespacesForRoutes(["/tasks/123"])).toEqual(["tasks"]);
    expect(
      i18nNamespacesForRoutes(["/search", "/notifications"]).sort(),
    ).toEqual(["notifications", "search"]);
  });

  it("ignores unknown paths and never lets `/` swallow other routes", () => {
    expect(i18nNamespacesForRoutes(["/nope"])).toEqual([]);
    expect(i18nNamespacesForRoutes(["/"])).toEqual(["auth"]);
  });

  it("ships the sign-in module's catalog with every page", () => {
    expect(publicI18nNamespaces).toEqual(["auth"]);
  });
});
