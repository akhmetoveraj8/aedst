import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import common from "@i18n/common/en.json";
import { describe, expect, it } from "vitest";
import {
  i18nNamespaces,
  manifests,
  moduleRoutes,
  navEntriesFor,
} from "@/app/config/modules/registry";
import { locales, sharedLocale } from "@/shared/i18n/locales";

const root = path.resolve(import.meta.dirname, "../../../..");
const modulesDir = path.join(root, "src/modules");
const sharedI18nDir = path.resolve(root, "../shared/i18n/catalogs");
const appDir = path.join(root, "src/app/(pages)/[locale]/(app)");

describe("module registry", () => {
  it("lists exactly the modules on disk, once each", () => {
    const onDisk = readdirSync(modulesDir, { withFileTypes: true })
      .filter((entry) => entry.isDirectory())
      .map((entry) => entry.name)
      .sort();
    expect(manifests.map((m) => m.id).sort()).toEqual(onDisk);
  });

  it("ships a catalogue in every locale for each declared namespace", () => {
    for (const module of manifests) {
      for (const namespace of module.i18nNamespaces) {
        expect(namespace).toBe(module.id);
        for (const locale of locales) {
          expect(
            existsSync(
              path.join(
                sharedI18nDir,
                module.id,
                `${sharedLocale(locale)}.json`,
              ),
            ),
          ).toBe(true);
        }
      }
    }
    expect(new Set(i18nNamespaces).size).toBe(i18nNamespaces.length);
  });

  it("backs every session route with a page under the app shell", () => {
    for (const route of moduleRoutes.filter((r) => r.access === "session")) {
      expect(existsSync(path.join(appDir, route.path, "page.tsx"))).toBe(true);
    }
    const paths = moduleRoutes.map((r) => r.path);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("labels every nav entry from common.nav and points it at a declared route", () => {
    const routePaths = moduleRoutes.map((r) => r.path);
    for (const entry of manifests.flatMap((m) => m.nav)) {
      expect(common.nav).toHaveProperty(entry.labelKey);
      expect(routePaths).toContain(entry.href);
    }
  });

  it("orders navigation and hides role-gated entries from other users", () => {
    expect(navEntriesFor(() => false).map((e) => e.href)).toEqual([
      "/tasks",
      "/search",
      "/notifications",
    ]);
    // The admin panel is its own project (apps/web/admin): no admin entry here,
    // whatever the user's roles.
    expect(
      navEntriesFor((role) => role === "admin").map((e) => e.href),
    ).toEqual(["/tasks", "/search", "/notifications"]);
  });
});
