/**
 * Client-side image compression before upload, with platform APIs only
 * (no image library): `createImageBitmap` decodes (respecting EXIF
 * orientation), an `OffscreenCanvas` (or a DOM canvas where Offscreen is
 * missing) resizes, and `convertToBlob`/`toBlob` re-encodes. The server
 * still produces its own variants; this just stops a 12 MB phone photo from
 * being uploaded at full size over a mobile connection.
 */

export type CompressionOptions = {
  /** Longest edge after resizing. */
  maxDimension?: number;
  /** Encoder quality for lossy formats, 0..1. */
  quality?: number;
  /** Files below this size are left alone. */
  minBytes?: number;
};

export type CompressionResult = {
  file: File;
  compressed: boolean;
};

const DEFAULTS = {
  maxDimension: 2560,
  quality: 0.85,
  minBytes: 512 * 1024,
} satisfies Required<CompressionOptions>;

/**
 * Formats worth re-encoding. GIF (animation), SVG (vector) and anything
 * unknown are uploaded untouched; PNG is kept lossless (only resized).
 */
const OUTPUT_TYPE: Record<string, string> = {
  "image/jpeg": "image/jpeg",
  "image/png": "image/png",
  "image/webp": "image/webp",
  "image/heic": "image/jpeg",
  "image/heif": "image/jpeg",
  "image/avif": "image/jpeg",
};

export function isCompressible(type: string): boolean {
  return type in OUTPUT_TYPE;
}

/** Target size that fits within `maxDimension`, never upscaling. */
export function fitWithin(
  width: number,
  height: number,
  maxDimension: number,
): { width: number; height: number } {
  const longest = Math.max(width, height);
  if (longest <= maxDimension) {
    return { width, height };
  }
  const scale = maxDimension / longest;
  return {
    width: Math.max(1, Math.round(width * scale)),
    height: Math.max(1, Math.round(height * scale)),
  };
}

function renameForType(name: string, type: string): string {
  const extension =
    type === "image/png" ? "png" : type === "image/webp" ? "webp" : "jpg";
  const base = name.replace(/\.[^.]+$/, "");
  return `${base || "image"}.${extension}`;
}

async function encode(
  bitmap: ImageBitmap,
  width: number,
  height: number,
  type: string,
  quality: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== "undefined") {
    const canvas = new OffscreenCanvas(width, height);
    const context = canvas.getContext("2d");
    if (!context) {
      return null;
    }
    context.drawImage(bitmap, 0, 0, width, height);
    return await canvas.convertToBlob({ type, quality });
  }
  const canvas = document.createElement("canvas");
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext("2d");
  if (!context) {
    return null;
  }
  context.drawImage(bitmap, 0, 0, width, height);
  return await new Promise((resolve) => canvas.toBlob(resolve, type, quality));
}

/**
 * Returns a smaller file when it can, otherwise the original — a failed
 * decode (unsupported codec), a missing API or a "compressed" result that
 * came out bigger all fall back to uploading what the user picked.
 */
export async function compressImage(
  file: File,
  options: CompressionOptions = {},
): Promise<CompressionResult> {
  const { maxDimension, quality, minBytes } = { ...DEFAULTS, ...options };
  const outputType = OUTPUT_TYPE[file.type];
  if (
    !outputType ||
    file.size < minBytes ||
    typeof createImageBitmap === "undefined"
  ) {
    return { file, compressed: false };
  }
  let bitmap: ImageBitmap | null = null;
  try {
    bitmap = await createImageBitmap(file, { imageOrientation: "from-image" });
    const target = fitWithin(bitmap.width, bitmap.height, maxDimension);
    const blob = await encode(
      bitmap,
      target.width,
      target.height,
      outputType,
      quality,
    );
    if (!blob || blob.size >= file.size) {
      return { file, compressed: false };
    }
    return {
      file: new File([blob], renameForType(file.name, outputType), {
        type: outputType,
        lastModified: file.lastModified,
      }),
      compressed: true,
    };
  } catch {
    return { file, compressed: false };
  } finally {
    bitmap?.close();
  }
}
