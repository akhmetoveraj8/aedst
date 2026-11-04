/**
 * PUTs a file straight to object storage with the presigned URL from
 * `MediaService.CreateUpload` — the bytes never pass through the API server
 * or this app's BFF. XMLHttpRequest rather than `fetch` because it is the
 * only cross-browser way to observe *upload* progress today (fetch upload
 * streaming/progress is Chromium-only and needs HTTP/2+); cancellation goes
 * through an AbortSignal like everywhere else.
 */

export class UploadError extends Error {
  constructor(
    message: string,
    readonly status: number,
    /** Worth retrying (network failure, 5xx, 408/429) vs. definitive (403 expired URL, 413). */
    readonly retryable: boolean,
  ) {
    super(message);
    this.name = "UploadError";
  }
}

export type PutOptions = {
  url: string;
  method?: string;
  headers?: Record<string, string>;
  body: Blob;
  signal?: AbortSignal;
  /** 0..1 */
  onProgress?: (fraction: number) => void;
};

export function putToStorage({
  url,
  method = "PUT",
  headers = {},
  body,
  signal,
  onProgress,
}: PutOptions): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(new DOMException("upload cancelled", "AbortError"));
      return;
    }
    const xhr = new XMLHttpRequest();
    xhr.open(method, url);
    for (const [name, value] of Object.entries(headers)) {
      xhr.setRequestHeader(name, value);
    }
    xhr.upload.onprogress = (event) => {
      if (event.lengthComputable && event.total > 0) {
        onProgress?.(event.loaded / event.total);
      }
    };
    const onAbort = () => xhr.abort();
    signal?.addEventListener("abort", onAbort, { once: true });
    const cleanup = () => signal?.removeEventListener("abort", onAbort);

    xhr.onload = () => {
      cleanup();
      if (xhr.status >= 200 && xhr.status < 300) {
        onProgress?.(1);
        resolve();
        return;
      }
      const retryable =
        xhr.status >= 500 || xhr.status === 408 || xhr.status === 429;
      reject(
        new UploadError(
          `storage responded ${xhr.status}`,
          xhr.status,
          retryable,
        ),
      );
    };
    xhr.onerror = () => {
      cleanup();
      reject(new UploadError("network error during upload", 0, true));
    };
    xhr.onabort = () => {
      cleanup();
      reject(new DOMException("upload cancelled", "AbortError"));
    };
    xhr.send(body);
  });
}

/** Hex SHA-256 (SubtleCrypto) — lets object storage verify integrity. */
export async function sha256Hex(blob: Blob): Promise<string> {
  const digest = await crypto.subtle.digest(
    "SHA-256",
    await blob.arrayBuffer(),
  );
  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
