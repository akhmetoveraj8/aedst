import {
  createLoader,
  type inferParserType,
  parseAsStringLiteral,
} from "nuqs/server";

import { cursorParsers } from "@/shared/lib/url/cursor-params";

export const STATUS_FILTERS = ["all", "todo", "in-progress", "done"] as const;
export const PRIORITY_FILTERS = [
  "all",
  "low",
  "medium",
  "high",
  "urgent",
] as const;
export const SORT_VALUES = [
  "created-desc",
  "created-asc",
  "due-asc",
  "due-desc",
] as const;

/**
 * The task list's whole view state, kept in the URL (`?q=&status=&priority=
 * &sort=&cursors=`) so a reload, a shared link and the back button all land
 * on the same view. Defaults are omitted from the URL by nuqs.
 *
 * `cursors` is the stack of page tokens visited so far: `ListTasksResponse`
 * only returns a *next* token, so "previous" pops this stack rather than the
 * server supporting backward paging — and because it lives in the URL it
 * survives a reload, unlike component state.
 */
export const taskSearchParsers = {
  ...cursorParsers,
  status: parseAsStringLiteral(STATUS_FILTERS).withDefault("all"),
  priority: parseAsStringLiteral(PRIORITY_FILTERS).withDefault("all"),
  sort: parseAsStringLiteral(SORT_VALUES).withDefault("created-desc"),
};

/** Server-side reader over the same parsers the client hook uses. */
export const loadTaskSearchParams = createLoader(taskSearchParsers);

export type TaskSearchParams = inferParserType<typeof taskSearchParsers>;
