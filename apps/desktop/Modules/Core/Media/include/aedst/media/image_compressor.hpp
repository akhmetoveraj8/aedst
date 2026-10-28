#pragma once

#include <QByteArray>
#include <QImage>
#include <QSize>
#include <QString>

#include <expected>

namespace aedst::media {

struct CompressionOptions {
    /// Longer edge after scaling; smaller images are never upscaled.
    int maxDimension{2560};
    /// QImageWriter quality, 0-100 (JPEG/WebP). 82 is visually lossless for photos.
    int quality{82};
    /// Output format for photos. PNG input with transparency is kept PNG (lossless).
    QByteArray format{"jpeg"};
    /// Below this size and dimension, the original is uploaded untouched.
    qint64 skipBelowBytes{512 * 1024};
};

struct CompressedImage {
    QString path;
    QByteArray contentType;
    qint64 sizeBytes{0};
    QSize size;
    /// False when the original was kept (already small, animated, or not an image).
    bool compressed{false};
};

/// Client-side downscale + re-encode before upload, with Qt's own codecs
/// (QImageReader / QImageWriter, no extra dependency):
///  - QImageReader::setAutoTransform applies EXIF orientation, and re-encoding
///    drops EXIF/XMP metadata (GPS location, camera serials) as a privacy bonus;
///  - QImageReader::setScaledSize decodes JPEGs directly at the reduced size
///    (DCT scaling), so a 50 MP photo never needs a full-size buffer;
///  - animated images (GIF/WebP/APNG) and non-images pass through unchanged.
/// The result is written to `outputPath`; a failure to write falls back to the
/// original (`compressed == false`). Blocking: call from a worker thread
/// (MediaUploadController runs it on QThreadPool).
[[nodiscard]] std::expected<CompressedImage, QString> compressImage(const QString& inputPath, const QString& outputPath,
                                                                    const CompressionOptions& options = {});

/// Decodes `path` scaled to fit `maxPixels` on its longer edge (cheap, for local
/// previews/thumbnails before upload). Null image on failure. Thread-safe.
[[nodiscard]] QImage readScaledImage(const QString& path, int maxPixels);

/// Size that fits `original` into a `maxDimension` square, keeping aspect ratio;
/// returns `original` when it already fits. Pure, for tests.
[[nodiscard]] QSize fitWithin(QSize original, int maxDimension);

} // namespace aedst::media
