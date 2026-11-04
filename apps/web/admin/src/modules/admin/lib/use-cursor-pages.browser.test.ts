import { act, renderHook } from "@testing-library/react";
import { NuqsTestingAdapter } from "nuqs/adapters/testing";
import { createElement, type ReactNode } from "react";
import { describe, expect, it } from "vitest";

import { useCursorPages } from "@/modules/admin/lib/use-cursor-pages";

function wrapperFor(searchParams = "") {
  return ({ children }: { children: ReactNode }) =>
    createElement(NuqsTestingAdapter, {
      hasMemory: true,
      searchParams,
      children,
    });
}

describe("useCursorPages", () => {
  it("pushes next tokens, pops on previous, ignores an empty token, resets", () => {
    const { result } = renderHook(() => useCursorPages(), {
      wrapper: wrapperFor(),
    });
    expect(result.current).toMatchObject({
      pageToken: "",
      page: 1,
      hasPrevious: false,
    });

    act(() => result.current.next("t2"));
    act(() => result.current.next("t3"));
    act(() => result.current.next(""));
    expect(result.current).toMatchObject({
      pageToken: "t3",
      page: 3,
      hasPrevious: true,
    });

    act(() => result.current.previous());
    expect(result.current.pageToken).toBe("t2");

    act(() => result.current.reset());
    expect(result.current).toMatchObject({ pageToken: "", page: 1 });
  });

  it("restores search and page from the URL, and a new search returns to page 1", () => {
    const { result } = renderHook(() => useCursorPages(), {
      wrapper: wrapperFor("?q=ann&cursors=a,b"),
    });
    expect(result.current).toMatchObject({
      query: "ann",
      pageToken: "b",
      page: 3,
    });

    act(() => result.current.setQuery("bob"));
    expect(result.current).toMatchObject({
      query: "bob",
      pageToken: "",
      page: 1,
    });
  });
});
