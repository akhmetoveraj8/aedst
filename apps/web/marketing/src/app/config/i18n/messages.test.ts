import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { legalSectionKeys } from "@/modules/legal/entries/section-keys";
import {
  faqKeys,
  featureKeys,
  stepKeys,
  tierKeys,
} from "@/modules/marketing/entries/content-keys";
import { type Locale, locales, sharedLocale } from "@/shared/i18n/locales";

const catalogRoot = path.resolve(
  import.meta.dirname,
  "../../../../../shared/i18n/catalogs",
);

const catalogs = {
  common: (locale: string) =>
    path.join(
      catalogRoot,
      "marketing-common",
      `${sharedLocale(locale as Locale)}.json`,
    ),
  marketing: (locale: string) =>
    path.join(
      catalogRoot,
      "marketing",
      `${sharedLocale(locale as Locale)}.json`,
    ),
  legal: (locale: string) =>
    path.join(catalogRoot, "legal", `${sharedLocale(locale as Locale)}.json`),
};

type Json = string | { [key: string]: Json };

function load(file: string): Json {
  return JSON.parse(readFileSync(file, "utf8")) as Json;
}

/** Flat `a.b.c` -> string map. */
function flatten(value: Json, prefix = ""): Record<string, string> {
  if (typeof value === "string") {
    return { [prefix]: value };
  }
  return Object.assign(
    {},
    ...Object.entries(value).map(([key, child]) =>
      flatten(child, prefix ? `${prefix}.${key}` : key),
    ),
  );
}

const placeholders = (text: string) => (text.match(/\{\w+\}/g) ?? []).sort();

describe.each(Object.entries(catalogs))("%s catalog", (_name, file) => {
  const reference = flatten(load(file("en")));

  it.each(locales.filter((locale) => locale !== "en"))(
    "%s has exactly the keys of en, none empty, same placeholders",
    (locale) => {
      const other = flatten(load(file(locale)));
      expect(Object.keys(other).sort()).toEqual(Object.keys(reference).sort());
      for (const [key, text] of Object.entries(other)) {
        expect(text.trim(), `${locale}:${key}`).not.toBe("");
        expect(placeholders(text), `${locale}:${key}`).toEqual(
          placeholders(reference[key] ?? ""),
        );
      }
    },
  );
});

describe("keys used by the sections exist in every locale", () => {
  const field = ["name", "price", "description", "f1", "f2", "f3", "cta"];
  const expected = [
    ...featureKeys.flatMap((k) => [
      `features.items.${k}.title`,
      `features.items.${k}.description`,
    ]),
    ...stepKeys.flatMap((k) => [
      `howItWorks.steps.${k}.title`,
      `howItWorks.steps.${k}.description`,
    ]),
    ...tierKeys.flatMap((k) => field.map((f) => `pricing.tiers.${k}.${f}`)),
    ...faqKeys.flatMap((k) => [
      `faq.items.${k}.question`,
      `faq.items.${k}.answer`,
    ]),
  ];

  it.each(locales)("%s marketing", (locale) => {
    const keys = flatten(load(catalogs.marketing(locale)));
    for (const key of expected) {
      expect(keys[key], `${locale}:${key}`).toBeTruthy();
    }
  });

  it.each(locales)("%s legal", (locale) => {
    const keys = flatten(load(catalogs.legal(locale)));
    for (const doc of ["privacy", "terms"]) {
      for (const section of legalSectionKeys) {
        expect(
          keys[`${doc}.sections.${section}.body`],
          `${locale}:${doc}.${section}`,
        ).toBeTruthy();
      }
    }
  });
});
