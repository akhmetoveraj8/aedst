//! Choosing which rendition to show.

use super::media::{Media, MediaKind, MediaStatus, Variant, VariantKind};

/// What the picture is for.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Purpose {
    /// A small tile: the smallest rendition that still covers the target.
    Thumbnail,
    /// The viewer: the sanitized original for images, the poster for videos.
    Preview,
}

const THUMBNAIL: [VariantKind; 6] = [
    VariantKind::Avatar256,
    VariantKind::Card400,
    VariantKind::Thumb64,
    VariantKind::Feed800x600,
    VariantKind::Story1080x1350,
    VariantKind::Poster,
];
const PREVIEW: [VariantKind; 6] = [
    VariantKind::Poster,
    VariantKind::Feed800x600,
    VariantKind::Story1080x1350,
    VariantKind::Card400,
    VariantKind::Avatar256,
    VariantKind::Thumb64,
];

fn longer_edge(v: &Variant) -> i32 {
    v.width.max(v.height)
}

fn best_of(media: &Media, kind: VariantKind, target: i32) -> Option<&Variant> {
    let mut best: Option<&Variant> = None;
    for v in media
        .variants
        .iter()
        .filter(|v| v.kind == kind && !v.url.is_empty())
    {
        let Some(current) = best else {
            best = Some(v);
            continue;
        };
        let covers = longer_edge(v) >= target;
        let current_covers = longer_edge(current) >= target;
        // The smallest that still covers the target; otherwise the largest.
        if (covers && (!current_covers || longer_edge(v) < longer_edge(current)))
            || (!covers && !current_covers && longer_edge(v) > longer_edge(current))
        {
            best = Some(v);
        }
    }
    best
}

fn original(media: &Media) -> Variant {
    Variant {
        kind: VariantKind::Unknown,
        url: media.url.clone(),
        content_type: media.content_type.clone(),
        width: media.width,
        height: media.height,
        size_bytes: media.size_bytes,
    }
}

/// The rendition to download for an image or a video poster, or `None` when there is nothing to
/// show. Only a `Ready` file has one; a video never falls back to its original (an image decoder
/// must not be handed a video file), an image falls back to the original URL.
#[must_use]
pub fn select_variant(media: &Media, purpose: Purpose, target_pixels: i32) -> Option<Variant> {
    if media.status != MediaStatus::Ready
        || !matches!(media.kind, MediaKind::Image | MediaKind::Video)
    {
        return None;
    }
    // The uncropped preview of an image is the sanitized original: presets are fixed boxes.
    if purpose == Purpose::Preview && media.kind == MediaKind::Image && !media.url.is_empty() {
        return Some(original(media));
    }
    let order = match purpose {
        Purpose::Thumbnail => &THUMBNAIL,
        Purpose::Preview => &PREVIEW,
    };
    for kind in order {
        if let Some(v) = best_of(media, *kind, target_pixels) {
            return Some(v.clone());
        }
    }
    (media.kind == MediaKind::Image && !media.url.is_empty()).then(|| original(media))
}
