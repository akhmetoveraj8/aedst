import { useTranslations } from "next-intl";

import { ImageViewer } from "@/modules/media/image/ImageViewer";
import { VideoPlayer } from "@/modules/media/video/VideoPlayer";
import {
  type Media,
  MediaKind,
  MediaStatus,
} from "@/shared/api/connect/generated/aedst/media/v1/media_pb";
import { buttonVariants } from "@/shared/ui/button";

/** Only http(s) links are rendered as hrefs; anything else (javascript:, data:) becomes "#". */
function safeHttpUrl(url: string): string {
  try {
    const { protocol } = new URL(url);
    return protocol === "https:" || protocol === "http:" ? url : "#";
  } catch {
    return "#";
  }
}

/** Renders any media item with the right native element for its kind. */
export function MediaPlayer({ media }: { media: Media }) {
  const t = useTranslations("media.player");

  if (media.status !== MediaStatus.READY) {
    return (
      <p className="text-muted-foreground text-sm" role="status">
        {media.status === MediaStatus.FAILED ? t("failed") : t("processing")}
      </p>
    );
  }

  switch (media.kind) {
    case MediaKind.IMAGE:
      return <ImageViewer media={media} alt={media.filename} />;
    case MediaKind.VIDEO:
      return <VideoPlayer media={media} label={media.filename} />;
    case MediaKind.AUDIO:
      return (
        // biome-ignore lint/a11y/useMediaCaption: user uploads have no caption track
        <audio
          controls
          preload="metadata"
          src={media.url}
          aria-label={media.filename}
          className="w-full"
        />
      );
    default:
      return (
        <a
          href={safeHttpUrl(media.url)}
          target="_blank"
          rel="noopener noreferrer"
          className={buttonVariants({ variant: "outline" })}
        >
          {t("open", { name: media.filename })}
        </a>
      );
  }
}
