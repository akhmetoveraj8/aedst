import { playbackSources, posterUrl } from "@/modules/media/thumbnail/variants";
import type { Media } from "@/shared/api/connect/generated/aedst/media/v1/media_pb";

/**
 * Native `<video>`: poster frame from the media pipeline (stored poster or
 * the `feed_800x600` rendition of it), the original as the source, the browser's own
 * accessible controls, and `preload="metadata"` so nothing streams until
 * the user presses play. No player library — progressive MP4/WebM needs
 * none; add one (hls.js / Shaka) only when the server starts emitting
 * adaptive HLS/DASH renditions.
 */
export function VideoPlayer({ media, label }: { media: Media; label: string }) {
  const sources = playbackSources(media);
  return (
    // biome-ignore lint/a11y/useMediaCaption: user uploads have no caption track; the server produces none yet
    <video
      controls
      preload="metadata"
      playsInline
      poster={posterUrl(media)}
      aria-label={label}
      width={media.width || undefined}
      height={media.height || undefined}
      className="max-h-[75vh] w-full rounded-md bg-black"
    >
      {sources.map((source) => (
        <source
          key={source.url}
          src={source.url}
          type={source.type || undefined}
        />
      ))}
    </video>
  );
}
