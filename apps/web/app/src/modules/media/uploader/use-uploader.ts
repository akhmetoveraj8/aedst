"use client";

import { Code, ConnectError } from "@connectrpc/connect";
import { createConnectQueryKey, useMutation } from "@connectrpc/connect-query";
import { useQueryClient } from "@tanstack/react-query";
import { useCallback } from "react";

import { compressImage } from "@/modules/media/compression/compress-image";
import {
  type UploadItem,
  uploadControllers,
  useUploadQueue,
} from "@/modules/media/lib/upload-queue-store";
import {
  putToStorage,
  sha256Hex,
  UploadError,
} from "@/modules/media/uploader/upload-file";
import { MediaService } from "@/shared/api/connect/client";
import { MediaKind } from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { track } from "@/shared/lib/analytics/analytics";
import { useFeatureFlag } from "@/shared/lib/analytics/use-feature-flag";
import { reportError } from "@/shared/lib/errors/report-error";

/** Hash only what is cheap to read into memory. */
const HASH_LIMIT_BYTES = 64 * 1024 * 1024;
/** Transient storage failures are retried automatically this many times. */
const AUTO_RETRIES = 2;

function errorKeyFor(error: unknown): string {
  if (error instanceof ConnectError) {
    switch (error.code) {
      case Code.InvalidArgument:
      case Code.OutOfRange:
        return "rejected";
      case Code.ResourceExhausted:
        return "tooLarge";
      case Code.PermissionDenied:
      case Code.NotFound:
        return "forbidden";
      default:
        return "server";
    }
  }
  if (error instanceof UploadError) {
    if (error.status === 413) {
      return "tooLarge";
    }
    return error.status === 0 ? "network" : "storage";
  }
  return "unknown";
}

function isRetryable(error: unknown): boolean {
  if (error instanceof UploadError) {
    return error.retryable;
  }
  return (
    error instanceof ConnectError &&
    [Code.Unavailable, Code.DeadlineExceeded, Code.ResourceExhausted].includes(
      error.code,
    )
  );
}

function isAbort(error: unknown): boolean {
  return (
    (error instanceof DOMException && error.name === "AbortError") ||
    (error instanceof ConnectError && error.code === Code.Canceled)
  );
}

/**
 * The upload pipeline for one queued file:
 * compress (images) → SHA-256 → `CreateUpload` (presigned PUT) → PUT with
 * progress → `CompleteUpload` (server verifies, then processes variants).
 * Cancel aborts whichever step is running; retry re-runs from the start
 * with a fresh presigned URL (the old one may have expired).
 */
export function useUploader() {
  const queryClient = useQueryClient();
  const compressionEnabled = useFeatureFlag("client-image-compression");
  const { add, update } = useUploadQueue();
  const createUpload = useMutation(MediaService.method.createUpload, {
    meta: { silent: true, feature: "media" },
  });
  const completeUpload = useMutation(MediaService.method.completeUpload, {
    meta: { silent: true, feature: "media" },
  });

  const run = useCallback(
    async (item: UploadItem) => {
      const controller = new AbortController();
      uploadControllers.set(item.id, controller);
      const { signal } = controller;
      update(item.id, {
        status: "compressing",
        progress: 0,
        errorKey: undefined,
      });
      try {
        const { file, compressed } = compressionEnabled
          ? await compressImage(item.file)
          : { file: item.file, compressed: false };
        signal.throwIfAborted();
        const sha256 =
          file.size <= HASH_LIMIT_BYTES ? await sha256Hex(file) : undefined;
        signal.throwIfAborted();

        update(item.id, { status: "uploading", compressed });
        let attempt = 0;
        let mediaId = "";
        for (;;) {
          try {
            const upload = await createUpload.mutateAsync({
              filename: file.name,
              contentType: file.type || "application/octet-stream",
              sizeBytes: BigInt(file.size),
              taskId: item.taskId,
              sha256,
            });
            mediaId = upload.media?.id ?? "";
            await putToStorage({
              url: upload.uploadUrl,
              method: upload.method || "PUT",
              headers: upload.headers,
              body: file,
              signal,
              onProgress: (progress) => update(item.id, { progress }),
            });
            break;
          } catch (error) {
            if (
              isAbort(error) ||
              !isRetryable(error) ||
              attempt >= AUTO_RETRIES
            ) {
              throw error;
            }
            attempt += 1;
            await new Promise((resolve) =>
              setTimeout(resolve, 1_000 * 2 ** attempt),
            );
            signal.throwIfAborted();
          }
        }

        update(item.id, { status: "finalizing", progress: 1 });
        const done = await completeUpload.mutateAsync({ id: mediaId });
        update(item.id, { status: "done", mediaId });
        track("media_uploaded", {
          kind:
            MediaKind[done.media?.kind ?? MediaKind.UNSPECIFIED] ?? "UNKNOWN",
          size_bytes: file.size,
          compressed,
          attached_to_task: Boolean(item.taskId),
        });
        await queryClient.invalidateQueries({
          queryKey: createConnectQueryKey({
            schema: MediaService,
            cardinality: undefined,
          }),
        });
      } catch (error) {
        if (isAbort(error) || signal.aborted) {
          update(item.id, { status: "cancelled" });
          return;
        }
        const errorKey = errorKeyFor(error);
        update(item.id, { status: "failed", errorKey });
        track("media_upload_failed", { reason: errorKey });
        reportError(error, {
          source: "upload",
          feature: "media",
          extra: { contentType: item.file.type, sizeBytes: item.file.size },
        });
      } finally {
        uploadControllers.delete(item.id);
      }
    },
    [compressionEnabled, update, createUpload, completeUpload, queryClient],
  );

  const enqueue = useCallback(
    (files: File[], taskId?: string) => {
      for (const item of add(files, taskId)) {
        void run(item);
      }
    },
    [add, run],
  );

  const cancel = useCallback((id: string) => {
    uploadControllers.get(id)?.abort();
  }, []);

  const retry = useCallback(
    (id: string) => {
      const item = useUploadQueue.getState().items.find((i) => i.id === id);
      if (item) {
        void run(item);
      }
    },
    [run],
  );

  return { enqueue, cancel, retry };
}
