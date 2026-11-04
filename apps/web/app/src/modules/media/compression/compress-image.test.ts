import { afterEach, describe, expect, it, vi } from "vitest";

import {
  compressImage,
  fitWithin,
  isCompressible,
} from "@/modules/media/compression/compress-image";

afterEach(() => {
  vi.unstubAllGlobals();
});

function bigFile(type: string, bytes = 2 * 1024 * 1024, name = "photo.heic") {
  return new File([new Uint8Array(bytes)], name, { type });
}

describe("fitWithin", () => {
  it("scales the longest edge down, keeping the aspect ratio", () => {
    expect(fitWithin(4000, 3000, 2000)).toEqual({ width: 2000, height: 1500 });
    expect(fitWithin(1000, 4000, 2000)).toEqual({ width: 500, height: 2000 });
  });

  it("never upscales", () => {
    expect(fitWithin(800, 600, 2000)).toEqual({ width: 800, height: 600 });
  });
});

describe("isCompressible", () => {
  it("re-encodes photos, leaves animations and vectors alone", () => {
    expect(isCompressible("image/jpeg")).toBe(true);
    expect(isCompressible("image/heic")).toBe(true);
    expect(isCompressible("image/gif")).toBe(false);
    expect(isCompressible("image/svg+xml")).toBe(false);
    expect(isCompressible("video/mp4")).toBe(false);
  });
});

describe("compressImage", () => {
  it("keeps small files and non-images untouched", async () => {
    const small = bigFile("image/jpeg", 10);
    expect(await compressImage(small)).toEqual({
      file: small,
      compressed: false,
    });
    const video = bigFile("video/mp4");
    expect(await compressImage(video)).toEqual({
      file: video,
      compressed: false,
    });
  });

  it("resizes through OffscreenCanvas and renames to the output type", async () => {
    const close = vi.fn();
    const drawImage = vi.fn();
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 5120, height: 2560, close }),
    );
    let size: [number, number] = [0, 0];
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        constructor(width: number, height: number) {
          size = [width, height];
        }
        getContext() {
          return { drawImage };
        }
        convertToBlob({ type }: { type: string }) {
          return Promise.resolve(new Blob([new Uint8Array(1000)], { type }));
        }
      },
    );

    const result = await compressImage(bigFile("image/heic"));

    expect(result.compressed).toBe(true);
    expect(result.file.type).toBe("image/jpeg");
    expect(result.file.name).toBe("photo.jpg");
    expect(result.file.size).toBe(1000);
    expect(size).toEqual([2560, 1280]);
    expect(close).toHaveBeenCalled();
  });

  it("falls back to the original when decoding fails or the result is larger", async () => {
    const original = bigFile("image/jpeg", 1024 * 1024, "a.jpg");
    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockRejectedValue(new Error("codec")),
    );
    expect((await compressImage(original)).file).toBe(original);

    vi.stubGlobal(
      "createImageBitmap",
      vi.fn().mockResolvedValue({ width: 10, height: 10, close: vi.fn() }),
    );
    vi.stubGlobal(
      "OffscreenCanvas",
      class {
        getContext() {
          return { drawImage: vi.fn() };
        }
        convertToBlob() {
          return Promise.resolve(new Blob([new Uint8Array(2 * 1024 * 1024)]));
        }
      },
    );
    expect(await compressImage(original)).toEqual({
      file: original,
      compressed: false,
    });
  });
});
