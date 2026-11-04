"use client";

import { File01Icon, Video01Icon } from "@hugeicons/core-free-icons";
import { HugeiconsIcon } from "@hugeicons/react";
import { useState } from "react";

import { pickThumbnailUrl } from "@/modules/media/thumbnail/variants";
import {
  type Media,
  MediaKind,
} from "@/shared/api/connect/generated/aedst/media/v1/media_pb";

/**
 * Square thumbnail from the server's imgproxy presets (ADR-0015):
 * `thumb_64` up to 32 px, `avatar_256` up to 128 px, `card_400` above
 * (see `presetForSize`); video items use their poster. A plain `<img>`
 * rather than `next/image`: the delivery URLs are already resized and
 * signed with an expiry, so the Next image optimizer would only cache dead
 * links.
 */
export function Thumbnail({
  media,
  size = 96,
  alt,
  onLoadError,
}: {
  media: Media;
  /** Rendered CSS width/height in px. */
  size?: number;
  alt: string;
  /** Called once when the image fails to load (e.g. its signed URL expired). */
  onLoadError?: () => void;
}) {
  const [failed, setFailed] = useState(false);
  const src = pickThumbnailUrl(media, size);
  if (!src || failed) {
    return (
      <span
        className="flex items-center justify-center rounded-md bg-muted text-muted-foreground"
        style={{ width: size, height: size }}
      >
        <HugeiconsIcon icon={File01Icon} strokeWidth={2} className="size-6" />
        <span className="sr-only">{alt}</span>
      </span>
    );
  }
  return (
    <span className="relative inline-flex">
      {/* biome-ignore lint/performance/noImgElement: signed, pre-resized imgproxy URLs; next/image would cache expiring URLs */}
      <img
        src={src}
        alt={alt}
        width={size}
        height={size}
        loading="lazy"
        decoding="async"
        onError={() => {
          setFailed(true);
          onLoadError?.();
        }}
        className="rounded-md bg-muted object-cover"
        style={{ width: size, height: size }}
      />
      {media.kind === MediaKind.VIDEO && (
        <span className="absolute end-1 bottom-1 rounded bg-black/60 p-0.5 text-white">
          <HugeiconsIcon
            icon={Video01Icon}
            strokeWidth={2}
            className="size-3.5"
          />
        </span>
      )}
    </span>
  );
}
