import { afterEach, describe, expect, it, vi } from "vitest";

import {
  putToStorage,
  sha256Hex,
  UploadError,
} from "@/modules/media/uploader/upload-file";

type Outcome = "ok" | "server-error" | "network" | "hang";

function stubXhr(outcome: Outcome, status = 200) {
  const instances: FakeXhr[] = [];
  class FakeXhr {
    upload: { onprogress?: (e: ProgressEvent) => void } = {};
    status = 0;
    onload?: () => void;
    onerror?: () => void;
    onabort?: () => void;
    headers: Record<string, string> = {};
    method = "";
    url = "";
    constructor() {
      instances.push(this);
    }
    open(method: string, url: string) {
      this.method = method;
      this.url = url;
    }
    setRequestHeader(name: string, value: string) {
      this.headers[name] = value;
    }
    send() {
      if (outcome === "hang") return;
      queueMicrotask(() => {
        if (outcome === "network") {
          this.onerror?.();
          return;
        }
        this.upload.onprogress?.({
          lengthComputable: true,
          loaded: 5,
          total: 10,
        } as ProgressEvent);
        this.status = status;
        this.onload?.();
      });
    }
    abort() {
      this.onabort?.();
    }
  }
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  return instances;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

const body = new Blob(["hello"]);

describe("putToStorage", () => {
  it("PUTs with the presigned headers and reports progress to 100%", async () => {
    const xhrs = stubXhr("ok");
    const progress: number[] = [];
    await putToStorage({
      url: "https://s3.example/o",
      headers: { "Content-Type": "image/png" },
      body,
      onProgress: (p) => progress.push(p),
    });
    expect(xhrs[0]).toMatchObject({
      method: "PUT",
      url: "https://s3.example/o",
      headers: { "Content-Type": "image/png" },
    });
    expect(progress).toEqual([0.5, 1]);
  });

  it("classifies failures as retryable or definitive", async () => {
    stubXhr("ok", 503);
    await expect(putToStorage({ url: "u", body })).rejects.toMatchObject({
      status: 503,
      retryable: true,
    });
    stubXhr("ok", 403);
    await expect(putToStorage({ url: "u", body })).rejects.toMatchObject({
      status: 403,
      retryable: false,
    });
    stubXhr("network");
    await expect(putToStorage({ url: "u", body })).rejects.toBeInstanceOf(
      UploadError,
    );
  });

  it("cancels through an AbortSignal", async () => {
    stubXhr("hang");
    const controller = new AbortController();
    const upload = putToStorage({ url: "u", body, signal: controller.signal });
    controller.abort();
    await expect(upload).rejects.toMatchObject({ name: "AbortError" });

    await expect(
      putToStorage({ url: "u", body, signal: controller.signal }),
    ).rejects.toMatchObject({ name: "AbortError" });
  });
});

describe("sha256Hex", () => {
  it("hashes with SubtleCrypto", async () => {
    expect(await sha256Hex(new Blob(["abc"]))).toBe(
      "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad",
    );
  });
});
