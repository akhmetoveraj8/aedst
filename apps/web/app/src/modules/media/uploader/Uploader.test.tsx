import { screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { useUploadQueue } from "@/modules/media/lib/upload-queue-store";
import { Uploader } from "@/modules/media/uploader/Uploader";
import {
  MediaKind,
  MediaService,
  MediaStatus,
} from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { backend, Code, rpc, rpcError } from "@/test/mocks/transport";
import { messages, renderWithProviders } from "@/test/render";

const t = messages.media.uploader;
const MEDIA_ID = "00000000-0000-4000-8000-0000000000aa";
const TASK_ID = "00000000-0000-4000-8000-0000000000bb";

/** Minimal XMLHttpRequest stand-in: records the PUT and reports progress. */
class FakeXhr {
  static requests: {
    method: string;
    url: string;
    headers: Record<string, string>;
  }[] = [];
  static status = 200;
  /** Status codes for successive sends; falls back to `status`. */
  static statuses: number[] = [];
  /** Never answer: for cancellation. */
  static hang = false;
  upload: { onprogress?: (e: ProgressEvent) => void } = {};
  status = 0;
  onload?: () => void;
  onerror?: () => void;
  onabort?: () => void;
  private request = {
    method: "",
    url: "",
    headers: {} as Record<string, string>,
  };
  open(method: string, url: string) {
    this.request = { method, url, headers: {} };
  }
  setRequestHeader(name: string, value: string) {
    this.request.headers[name] = value;
  }
  send() {
    FakeXhr.requests.push(this.request);
    if (FakeXhr.hang) {
      return;
    }
    const status = FakeXhr.statuses.shift() ?? FakeXhr.status;
    queueMicrotask(() => {
      this.upload.onprogress?.({
        lengthComputable: true,
        loaded: 1,
        total: 2,
      } as ProgressEvent);
      this.status = status;
      this.onload?.();
    });
  }
  abort() {
    this.onabort?.();
  }
}

beforeEach(() => {
  FakeXhr.requests = [];
  FakeXhr.status = 200;
  FakeXhr.statuses = [];
  FakeXhr.hang = false;
  vi.stubGlobal("XMLHttpRequest", FakeXhr);
  useUploadQueue.setState({ items: [] });
});

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("Uploader", () => {
  it("creates an upload, PUTs to the presigned URL, then completes it", async () => {
    const created: { taskId: string; sha256: string; filename: string }[] = [];
    let completed = "";
    backend.use(
      rpc(MediaService.method.createUpload, (input) => {
        created.push({
          taskId: input.taskId,
          sha256: input.sha256,
          filename: input.filename,
        });
        return {
          media: { id: MEDIA_ID },
          uploadUrl: "https://storage.example/put",
          method: "PUT",
          headers: { "Content-Type": "application/pdf" },
        };
      }),
      rpc(MediaService.method.completeUpload, (input) => {
        completed = input.id;
        return {
          media: {
            id: MEDIA_ID,
            kind: MediaKind.DOCUMENT,
            status: MediaStatus.PROCESSING,
          },
        };
      }),
    );

    renderWithProviders(<Uploader taskId={TASK_ID} />);
    await userEvent.upload(
      screen.getByLabelText(new RegExp(t.dropzone)),
      new File(["%PDF"], "notes.pdf", { type: "application/pdf" }),
    );

    expect(await screen.findByText(t.status.done)).toBeInTheDocument();
    expect(created).toEqual([
      {
        taskId: TASK_ID,
        sha256: expect.stringMatching(/^[0-9a-f]{64}$/),
        filename: "notes.pdf",
      },
    ]);
    expect(FakeXhr.requests).toEqual([
      {
        method: "PUT",
        url: "https://storage.example/put",
        headers: { "Content-Type": "application/pdf" },
      },
    ]);
    expect(completed).toBe(MEDIA_ID);
  });

  it("explains a rejected file and offers a retry", async () => {
    backend.use(
      rpcError(MediaService.method.createUpload, Code.InvalidArgument, "type"),
    );
    renderWithProviders(<Uploader />);
    await userEvent.upload(
      screen.getByLabelText(new RegExp(t.dropzone)),
      new File(["x"], "virus.exe", { type: "application/pdf" }),
    );

    expect(await screen.findByRole("alert")).toHaveTextContent(
      t.errors.rejected,
    );
    expect(
      screen.getByRole("button", { name: "Retry upload of virus.exe" }),
    ).toBeInTheDocument();
  });

  it("retries a transient storage failure with a fresh presigned URL", async () => {
    vi.useFakeTimers({ shouldAdvanceTime: true });
    FakeXhr.statuses = [503];
    let creates = 0;
    backend.use(
      rpc(MediaService.method.createUpload, () => {
        creates += 1;
        return { media: { id: MEDIA_ID }, uploadUrl: `https://s/${creates}` };
      }),
      rpc(MediaService.method.completeUpload, () => ({
        media: { id: MEDIA_ID, kind: MediaKind.IMAGE },
      })),
    );
    renderWithProviders(<Uploader />);
    await userEvent.upload(
      screen.getByLabelText(new RegExp(t.dropzone)),
      new File(["x"], "a.gif", { type: "image/gif" }),
    );
    await vi.advanceTimersByTimeAsync(3_000);
    expect(await screen.findByText(t.status.done)).toBeInTheDocument();
    expect(creates).toBe(2);
    expect(FakeXhr.requests.map((r) => r.url)).toEqual([
      "https://s/1",
      "https://s/2",
    ]);
    vi.useRealTimers();
  });

  it("cancels an upload in flight and can retry it", async () => {
    FakeXhr.hang = true;
    backend.use(
      rpc(MediaService.method.createUpload, () => ({
        media: { id: MEDIA_ID },
        uploadUrl: "https://s/put",
      })),
    );
    renderWithProviders(<Uploader />);
    await userEvent.upload(
      screen.getByLabelText(new RegExp(t.dropzone)),
      new File(["x"], "big.mov", { type: "video/quicktime" }),
    );
    await userEvent.click(
      await screen.findByRole("button", { name: "Cancel upload of big.mov" }),
    );
    expect(await screen.findByText(t.status.cancelled)).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Retry upload of big.mov" }),
    ).toBeInTheDocument();
  });

  it("can clear finished uploads", async () => {
    useUploadQueue.setState({
      items: [
        {
          id: "1",
          file: new File(["a"], "a.png"),
          status: "done",
          progress: 1,
        },
      ],
    });
    renderWithProviders(<Uploader />);
    await userEvent.click(
      screen.getByRole("button", { name: t.clearFinished }),
    );
    await waitFor(() => expect(useUploadQueue.getState().items).toEqual([]));
  });
});
