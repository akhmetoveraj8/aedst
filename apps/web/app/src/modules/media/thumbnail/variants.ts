import {
  type Media,
  MediaKind,
  type Variant,
  VariantKind,
} from "@/shared/api/connect/generated/aedst/media/v1/media_pb";

/**
 * Picking renditions from `Media.variants` (ADR-0015). The server returns
 * signed imgproxy URLs for fixed presets; the format (WebP/AVIF/JPEG) is
 * negotiated by the browser's `Accept` header, so `contentType`/`sizeBytes`
 * are empty. Presets have different crops (square, 4:3, 4:5), so they are
 * never mixed in one `srcset`: the caller names the preset for its UI
 * context. The original (`Media.url`) is only used when the server returned
 * no variant at all (imgproxy disabled). URLs are short-lived, so they come
 * from the latest `GetMedia`/`ListMedia` response and are never persisted.
 */

export type ImagePreset =
  | "thumb_64"
  | "avatar_256"
  | "card_400"
  | "feed_800x600"
  | "story_1080x1350";

/** Presets from smallest to largest; also the nearest-fallback order. */
const PRESET_ORDER: readonly ImagePreset[] = [
  "thumb_64",
  "avatar_256",
  "card_400",
  "feed_800x600",
  "story_1080x1350",
];

const PRESET_KIND: Record<ImagePreset, VariantKind> = {
  thumb_64: VariantKind.THUMB_64,
  avatar_256: VariantKind.AVATAR_256,
  card_400: VariantKind.CARD_400,
  feed_800x600: VariantKind.FEED_800X600,
  story_1080x1350: VariantKind.STORY_1080X1350,
};

/** Presets ordered by distance from `preset` (itself first, then nearest). */
function nearestFirst(preset: ImagePreset): ImagePreset[] {
  const at = PRESET_ORDER.indexOf(preset);
  return [...PRESET_ORDER].sort(
    (a, b) =>
      Math.abs(PRESET_ORDER.indexOf(a) - at) -
      Math.abs(PRESET_ORDER.indexOf(b) - at),
  );
}

/**
 * The variant for `preset`, or the nearest preset the server did return;
 * `undefined` when there is no image variant at all.
 */
function pickVariant(media: Media, preset: ImagePreset): Variant | undefined {
  for (const candidate of nearestFirst(preset)) {
    const found = media.variants.find(
      (variant) => variant.kind === PRESET_KIND[candidate] && variant.url,
    );
    if (found) {
      return found;
    }
  }
  return undefined;
}

/** Stored poster frame (video), if any. */
function storedPoster(media: Media): Variant | undefined {
  return media.variants.find(
    (variant) => variant.kind === VariantKind.POSTER && variant.url,
  );
}

/**
 * URL for an image slot: the preset (or nearest), then the video poster, then
 * the original image; `""` for anything else (documents, audio).
 */
export function pickImageUrl(media: Media, preset: ImagePreset): string {
  const variant = pickVariant(media, preset);
  if (variant) {
    return variant.url;
  }
  const poster = storedPoster(media);
  if (poster) {
    return poster.url;
  }
  return media.kind === MediaKind.IMAGE ? media.url : "";
}

/** Preset for a square slot of `size` CSS px (thumbs and avatars). */
export function presetForSize(size: number): ImagePreset {
  if (size <= 32) {
    return "thumb_64";
  }
  return size <= 128 ? "avatar_256" : "card_400";
}

/** The best single URL for a square thumbnail slot of `size` CSS px. */
export function pickThumbnailUrl(media: Media, size: number): string {
  return pickImageUrl(media, presetForSize(size));
}

/** Avatar image (`avatar_256`). */
export function pickAvatarUrl(media: Media): string {
  return pickImageUrl(media, "avatar_256");
}

/** Feed image (`feed_800x600`). */
export function pickFeedUrl(media: Media): string {
  return pickImageUrl(media, "feed_800x600");
}

/** Story image (`story_1080x1350`). */
export function pickStoryUrl(media: Media): string {
  return pickImageUrl(media, "story_1080x1350");
}

/**
 * Poster frame for video: the stored poster at full size, else the derived
 * `feed_800x600` rendition of it.
 */
export function posterUrl(media: Media): string | undefined {
  return (
    storedPoster(media)?.url ||
    pickVariant(media, "feed_800x600")?.url ||
    undefined
  );
}

/** Playback sources: the original only (no re-encoded renditions). */
export function playbackSources(media: Media): { url: string; type: string }[] {
  return media.url ? [{ url: media.url, type: media.contentType }] : [];
}
