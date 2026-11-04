"use client";

import { useTranslations } from "next-intl";
import { useState } from "react";

import { pickImageUrl } from "@/modules/media/thumbnail/variants";
import type { Media } from "@/shared/api/connect/generated/aedst/media/v1/media_pb";

/**
 * Full-size image view. imgproxy presets are fixed boxes (most crop), so the
 * uncropped detail view uses the sanitized original (`Media.url`); only when
 * that is empty does it fall back to the `card_400` rendition (or the nearest
 * preset the server returned). The delivery URLs expire, so a failed load
 * shows a message instead of a broken-image icon.
 */
export function ImageViewer({ media, alt }: { media: Media; alt: string }) {
  const t = useTranslations("media.player");
  const [failed, setFailed] = useState(false);
  if (failed) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {t("imageError")}
      </p>
    );
  }
  return (
    // biome-ignore lint/performance/noImgElement: presigned/signed delivery URLs expire; next/image would cache dead links
    <img
      src={media.url || pickImageUrl(media, "card_400")}
      alt={alt}
      width={media.width || undefined}
      height={media.height || undefined}
      decoding="async"
      onError={() => setFailed(true)}
      className="max-h-[75vh] w-full rounded-md object-contain"
    />
  );
}
