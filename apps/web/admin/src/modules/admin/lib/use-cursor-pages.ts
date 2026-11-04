"use client";

import { useQueryStates } from "nuqs";
import { useCallback } from "react";

import { cursorParsers } from "@/shared/lib/url/cursor-params";

/**
 * Keyset pagination and search for admin lists, kept in the URL
 * (`?q=&cursors=`, see `cursorParsers`) so a reload, a shared link and the
 * back button restore the view. The server only returns a *next* token, so
 * "previous" pops the stack of tokens visited so far.
 */
export function useCursorPages() {
  const [params, setParams] = useQueryStates(cursorParsers);
  const { q, cursors } = params;

  const next = useCallback(
    (token: string) => {
      if (token) {
        void setParams({ cursors: [...cursors, token] });
      }
    },
    [cursors, setParams],
  );
  const previous = useCallback(() => {
    void setParams({ cursors: cursors.slice(0, -1) });
  }, [cursors, setParams]);
  const reset = useCallback(() => {
    void setParams({ cursors: [] });
  }, [setParams]);
  /** A new search starts again from the first page. */
  const setQuery = useCallback(
    (value: string) => {
      void setParams({ q: value, cursors: [] });
    },
    [setParams],
  );

  return {
    query: q,
    setQuery,
    pageToken: cursors[cursors.length - 1] ?? "",
    page: cursors.length + 1,
    hasPrevious: cursors.length > 0,
    next,
    previous,
    reset,
  };
}
