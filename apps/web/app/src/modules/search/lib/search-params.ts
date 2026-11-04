import { parseAsString, parseAsStringLiteral } from "nuqs/server";

import { DocumentKind } from "@/shared/api/connect/generated/aedst/search/v1/search_pb";

export const KIND_FILTERS = ["all", "task", "media"] as const;
export type KindFilter = (typeof KIND_FILTERS)[number];

/** `/search?q=&kind=` — shareable, reloadable, back-button friendly. */
export const searchParsers = {
  q: parseAsString.withDefault(""),
  kind: parseAsStringLiteral(KIND_FILTERS).withDefault("all"),
};

export function kindsFor(filter: KindFilter): DocumentKind[] {
  switch (filter) {
    case "task":
      return [DocumentKind.TASK];
    case "media":
      return [DocumentKind.MEDIA];
    default:
      return [];
  }
}

/** Server rule: 1..200 characters, so blank or whitespace never queries. */
export function normalizeQuery(raw: string): string {
  return raw.trim().slice(0, 200);
}
