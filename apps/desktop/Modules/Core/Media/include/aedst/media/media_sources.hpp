#pragma once

#include <QString>
#include <QUrl>

#include <aedst/media/v1/media.pb.h>

namespace aedst::media {

namespace mediav1 = ::aedst::media::v1;

/// What a view is about to draw; decides which server variant fits.
enum class DisplayPurpose {
    /// Grid cells / attachment chips (<= ~256 px).
    Thumbnail,
    /// Detail view / lightbox (screen-sized).
    Preview,
    /// Video playback.
    Playback,
};

/// The smallest READY imgproxy rendition (ADR-0015) that still covers `targetPixels`
/// on its longer edge, preferring the preset meant for `purpose`:
///  - Thumbnail: AVATAR_256, CARD_400, THUMB_64, FEED_800X600, STORY_1080X1350, POSTER;
///  - Preview:   POSTER, FEED_800X600, STORY_1080X1350, CARD_400, AVATAR_256, THUMB_64;
///  - Playback:  none (the original).
/// Returns nullptr when the server returned no suitable variant (imgproxy disabled)
/// or nothing is ready; then urlFor() falls back to media.url() or a local thumbnail.
[[nodiscard]] const mediav1::Variant* selectVariant(const mediav1::Media& media, DisplayPurpose purpose,
                                                    int targetPixels);

/// URL a view loads for `purpose`: a variant's signed URL, the original (always for an
/// image Preview, which must be uncropped; otherwise only when no variant exists), or empty.
[[nodiscard]] QUrl urlFor(const mediav1::Media& media, DisplayPurpose purpose, int targetPixels);

/// Image source for MediaImageProvider: `image://media/<mediaId>/<kind>?u=<url>`.
/// Signed URLs rotate on every fetch, so the provider caches by
/// `<mediaId>/<kind>` (stable) and only uses `u` to download on a cache miss.
/// Empty when there is nothing displayable (not READY, or not an image/video).
[[nodiscard]] QString imageSourceFor(const mediav1::Media& media, DisplayPurpose purpose, int targetPixels);

/// "image" | "video" | "audio" | "document" | "" - QML-friendly kind names.
[[nodiscard]] QString kindName(mediav1::MediaKind kind);
/// "pending" | "processing" | "ready" | "failed" | "".
[[nodiscard]] QString statusName(mediav1::MediaStatus status);

/// Parses an `image://media/...` id (the part after the provider name).
struct ImageRequest {
    QString cacheKey;
    QUrl url;
};

[[nodiscard]] ImageRequest parseImageId(const QString& id);

} // namespace aedst::media
