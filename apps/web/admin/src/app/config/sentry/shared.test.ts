import type { Breadcrumb, ErrorEvent } from "@sentry/nextjs";
import { describe, expect, it } from "vitest";

import {
  beforeBreadcrumb,
  beforeSend,
  scrubUrl,
} from "@/app/config/sentry/shared";

describe("scrubUrl", () => {
  it("filters secrets in query strings, keeping the rest", () => {
    expect(
      scrubUrl(
        "https://app.example/cb?code=abc&state=xyz&lang=en&X-Amz-Signature=deadbeef",
      ),
    ).toBe(
      "https://app.example/cb?code=[Filtered]&state=[Filtered]&lang=en&X-Amz-Signature=[Filtered]",
    );
    expect(scrubUrl("/tasks?status=done")).toBe("/tasks?status=done");
  });
});

describe("beforeBreadcrumb", () => {
  it("drops chatty console breadcrumbs but keeps warnings and errors", () => {
    expect(beforeBreadcrumb({ category: "console", level: "log" })).toBeNull();
    expect(
      beforeBreadcrumb({ category: "console", level: "warning" }),
    ).not.toBeNull();
  });

  it("scrubs navigation/fetch URLs and bearer tokens", () => {
    const crumb = beforeBreadcrumb({
      category: "fetch",
      message: "Authorization: Bearer eyJ.abc.def",
      data: {
        url: "https://s3.example/o?X-Amz-Signature=1",
        from: "/a?token=t",
      },
    }) as Breadcrumb;
    expect(crumb.data?.url).toBe(
      "https://s3.example/o?X-Amz-Signature=[Filtered]",
    );
    expect(crumb.data?.from).toBe("/a?token=[Filtered]");
    expect(crumb.message).toBe("Authorization: Bearer [Filtered]");
  });
});

describe("beforeSend", () => {
  it("removes cookies and auth headers and scrubs request URLs", () => {
    const event = beforeSend({
      type: undefined,
      request: {
        url: "https://app.example/en?token=abc",
        query_string: "token=abc&x=1",
        cookies: { aedst_session: "secret" },
        headers: { Authorization: "Bearer x", Cookie: "a=b", Accept: "*/*" },
      },
    } as ErrorEvent);
    expect(event.request?.cookies).toBeUndefined();
    expect(event.request?.headers).toEqual({
      Authorization: "[Filtered]",
      Cookie: "[Filtered]",
      Accept: "*/*",
    });
    expect(event.request?.url).toBe("https://app.example/en?token=[Filtered]");
    expect(event.request?.query_string).toBe("token=[Filtered]&x=1");
  });
});
