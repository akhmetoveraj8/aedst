import { createLoader, parseAsArrayOf, parseAsString } from "nuqs/server";

/**
 * URL state shared by every cursor-paged list (tasks, admin users, admin
 * tasks, audit log): `?q=<search>&cursors=<t1>,<t2>`.
 *
 * The API only returns a *next* page token, so "previous" pops the `cursors`
 * stack of tokens visited so far. Keeping both in the URL means a reload, a
 * shared link and the back button restore the same view. Defaults are omitted
 * from the URL by nuqs. Importable from server and client code (`nuqs/server`).
 */
export const cursorParsers = {
  q: parseAsString.withDefault(""),
  cursors: parseAsArrayOf(parseAsString).withDefault([]),
};

/** Server-side reader over the same parsers the client hooks use. */
export const loadCursorParams = createLoader(cursorParsers);
