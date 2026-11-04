//! The viewer's view model: downloads an image variant, decodes it on a blocking thread under a
//! pixel cap and publishes the RGBA pixels. Videos show a placeholder (no player is approved,
//! ADR-0001); other kinds have no preview.
//!
//! A result that belongs to an older `open` (the user opened something else or closed the viewer)
//! is dropped.

use std::{
    io::Cursor,
    sync::{Arc, Mutex, PoisonError},
};

use aedst_common::ErrorKind;
use image::{ImageReader, Limits};
use tokio::sync::watch;

use crate::domain::{ImageFetcher, Media, MediaKind, MediaStatus, Purpose, select_variant};

/// Largest download accepted for one image.
pub const MAX_DOWNLOAD_BYTES: u64 = 40 * 1024 * 1024;
/// Largest image decoded, in pixels (a 6000 x 6000 photo): 4 bytes each once decoded.
pub const MAX_PIXELS: u64 = 40_000_000;
/// Decoder allocation cap.
const MAX_ALLOC: u64 = 400 * 1024 * 1024;
/// The size the viewer would like; a variant that covers it is preferred.
const TARGET_PIXELS: i32 = 1600;

/// A decoded picture: tightly packed RGBA8, `width * height * 4` bytes.
#[derive(Debug)]
pub struct DecodedImage {
    /// Width in pixels.
    pub width: u32,
    /// Height in pixels.
    pub height: u32,
    /// Pixels.
    pub rgba: Vec<u8>,
}

/// Why the bytes could not become a picture.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum DecodeError {
    /// More pixels than [`MAX_PIXELS`].
    TooLarge,
    /// Not a picture this build can decode.
    Undecodable,
}

/// Decodes `bytes` (JPEG, PNG, GIF or WebP) under the pixel and allocation caps. Runs the whole
/// decode: call it from a blocking thread.
///
/// # Errors
/// [`DecodeError`].
pub fn decode(bytes: &[u8]) -> Result<DecodedImage, DecodeError> {
    let reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| DecodeError::Undecodable)?;
    let (width, height) = reader
        .into_dimensions()
        .map_err(|_| DecodeError::Undecodable)?;
    if u64::from(width) * u64::from(height) > MAX_PIXELS {
        return Err(DecodeError::TooLarge);
    }
    let mut reader = ImageReader::new(Cursor::new(bytes))
        .with_guessed_format()
        .map_err(|_| DecodeError::Undecodable)?;
    let mut limits = Limits::default();
    limits.max_alloc = Some(MAX_ALLOC);
    reader.limits(limits);
    let rgba = reader
        .decode()
        .map_err(|_| DecodeError::Undecodable)?
        .into_rgba8();
    Ok(DecodedImage {
        width: rgba.width(),
        height: rgba.height(),
        rgba: rgba.into_raw(),
    })
}

/// Where the viewer stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ViewerPhase {
    /// Not showing anything.
    Closed,
    /// Downloading or decoding.
    Loading,
    /// The picture is available.
    Ready,
    /// The download failed; show the translated message of this kind.
    Failed(ErrorKind),
    /// The file is not ready (still uploading or processing, or failed) or has no usable URL.
    NotReady,
    /// A video: "Video playback is not available yet".
    VideoUnavailable,
    /// Audio, documents and unknown kinds have no preview here.
    NoPreview,
    /// More pixels or bytes than the viewer accepts.
    TooLarge,
    /// The bytes are not a picture this build can decode.
    Undecodable,
}

/// Everything the viewer shows.
#[derive(Clone, Debug)]
pub struct ViewerView {
    /// Phase.
    pub phase: ViewerPhase,
    /// The file name.
    pub title: String,
    /// The decoded picture, when `phase` is `Ready`.
    pub image: Option<Arc<DecodedImage>>,
}

impl Default for ViewerView {
    fn default() -> Self {
        Self {
            phase: ViewerPhase::Closed,
            title: String::new(),
            image: None,
        }
    }
}

/// Drives the viewer.
pub struct ViewerController {
    fetcher: Arc<dyn ImageFetcher>,
    epoch: Mutex<u64>,
    published: watch::Sender<ViewerView>,
}

impl ViewerController {
    /// A controller over the downloader.
    #[must_use]
    pub fn new(fetcher: Arc<dyn ImageFetcher>) -> Arc<Self> {
        Arc::new(Self {
            fetcher,
            epoch: Mutex::new(0),
            published: watch::channel(ViewerView::default()).0,
        })
    }

    /// The UI subscribes here.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<ViewerView> {
        self.published.subscribe()
    }

    fn next_epoch(&self) -> u64 {
        let mut epoch = self.epoch.lock().unwrap_or_else(PoisonError::into_inner);
        *epoch += 1;
        *epoch
    }

    fn current(&self, epoch: u64) -> bool {
        *self.epoch.lock().unwrap_or_else(PoisonError::into_inner) == epoch
    }

    fn show(&self, phase: ViewerPhase, title: &str, image: Option<Arc<DecodedImage>>) {
        self.published.send_replace(ViewerView {
            phase,
            title: title.to_owned(),
            image,
        });
    }

    /// Closes the viewer; a download in flight is ignored when it ends.
    pub fn close(&self) {
        self.next_epoch();
        self.published.send_replace(ViewerView::default());
    }

    /// Opens `media`: downloads, decodes and publishes the picture for an image.
    pub async fn open(&self, media: &Media) {
        let epoch = self.next_epoch();
        let title = media.filename.as_str();
        if media.status != MediaStatus::Ready {
            return self.show(ViewerPhase::NotReady, title, None);
        }
        match media.kind {
            MediaKind::Image => {}
            MediaKind::Video => return self.show(ViewerPhase::VideoUnavailable, title, None),
            _ => return self.show(ViewerPhase::NoPreview, title, None),
        }
        let Some(variant) = select_variant(media, Purpose::Preview, TARGET_PIXELS) else {
            return self.show(ViewerPhase::NotReady, title, None);
        };
        let declared_pixels = u64::try_from(variant.width.max(0)).unwrap_or(0)
            * u64::try_from(variant.height.max(0)).unwrap_or(0);
        let declared_bytes = u64::try_from(variant.size_bytes.max(0)).unwrap_or(0);
        if declared_pixels > MAX_PIXELS || declared_bytes > MAX_DOWNLOAD_BYTES {
            return self.show(ViewerPhase::TooLarge, title, None);
        }

        self.show(ViewerPhase::Loading, title, None);
        let bytes = match self.fetcher.fetch(&variant.url, MAX_DOWNLOAD_BYTES).await {
            Ok(bytes) => bytes,
            Err(kind) => {
                if self.current(epoch) {
                    let phase = if kind == ErrorKind::Cancelled {
                        ViewerPhase::Closed
                    } else {
                        ViewerPhase::Failed(kind)
                    };
                    self.show(phase, title, None);
                }
                return;
            }
        };
        if !self.current(epoch) {
            return;
        }
        let decoded = tokio::task::spawn_blocking(move || decode(&bytes)).await;
        if !self.current(epoch) {
            return;
        }
        match decoded {
            Ok(Ok(image)) => self.show(ViewerPhase::Ready, title, Some(Arc::new(image))),
            Ok(Err(DecodeError::TooLarge)) => self.show(ViewerPhase::TooLarge, title, None),
            Ok(Err(DecodeError::Undecodable)) | Err(_) => {
                self.show(ViewerPhase::Undecodable, title, None);
            }
        }
    }
}
