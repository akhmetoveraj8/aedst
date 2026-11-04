//! The media model. Unknown server values map to `Unknown` and are never offered in pickers.

use std::fmt;

/// Page size of the library list (the server accepts 0..=100).
pub const PAGE_SIZE: i32 = 60;

/// A presigned URL. Its query string is a credential: `Debug` never shows it, and the only way
/// to read it is [`SecretUrl::expose`], used by the data layer to make the one request.
#[derive(Clone, PartialEq, Eq)]
pub struct SecretUrl(String);

impl SecretUrl {
    /// Wraps a URL string.
    #[must_use]
    pub fn new(url: impl Into<String>) -> Self {
        Self(url.into())
    }

    /// The URL, for the one request that needs it. Never log or format the result.
    #[must_use]
    pub fn expose(&self) -> &str {
        &self.0
    }

    /// True when the server sent no URL.
    #[must_use]
    pub fn is_empty(&self) -> bool {
        self.0.is_empty()
    }
}

impl fmt::Debug for SecretUrl {
    fn fmt(&self, f: &mut fmt::Formatter<'_>) -> fmt::Result {
        f.write_str("SecretUrl(<redacted>)")
    }
}

/// What kind of file this is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MediaKind {
    /// A picture.
    Image,
    /// A video (playback is not available yet).
    Video,
    /// Sound.
    Audio,
    /// A PDF or plain text.
    Document,
    /// Not known to this build.
    Unknown,
}

impl MediaKind {
    /// Stable key used by the UI.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::Image => "image",
            Self::Video => "video",
            Self::Audio => "audio",
            Self::Document => "document",
            Self::Unknown => "unknown",
        }
    }
}

/// Where the server stands with a file.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum MediaStatus {
    /// Upload URL issued; the object is not confirmed yet ("uploading").
    PendingUpload,
    /// The server is verifying and processing the object.
    Processing,
    /// Usable.
    Ready,
    /// Rejected or unprocessable; see [`FailureKind`].
    Failed,
    /// Not known to this build.
    Unknown,
}

impl MediaStatus {
    /// Stable key used by the UI.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::PendingUpload => "uploading",
            Self::Processing => "processing",
            Self::Ready => "ready",
            Self::Failed => "failed",
            Self::Unknown => "unknown",
        }
    }

    /// The server is still working: the list polls until this is false.
    #[must_use]
    pub fn unfinished(self) -> bool {
        matches!(self, Self::PendingUpload | Self::Processing)
    }
}

/// Why the server marked a file failed. The server sends free text; the UI shows the translated
/// text of this kind, never the server's wording.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum FailureKind {
    /// The uploaded size differs from the declared size.
    SizeMismatch,
    /// The content does not match the declared type.
    TypeMismatch,
    /// Anything else (the file could not be processed).
    Unprocessable,
}

impl FailureKind {
    /// Classifies the server's reason text. Empty or unrecognised text is `Unprocessable`.
    #[must_use]
    pub fn from_reason(reason: &str) -> Self {
        let lower = reason.to_ascii_lowercase();
        if lower.contains("size") {
            Self::SizeMismatch
        } else if lower.contains("type") {
            Self::TypeMismatch
        } else {
            Self::Unprocessable
        }
    }

    /// Stable key used by the UI.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::SizeMismatch => "sizeMismatch",
            Self::TypeMismatch => "typeMismatch",
            Self::Unprocessable => "unprocessable",
        }
    }
}

/// Which rendition a variant is.
#[derive(Clone, Copy, Debug, PartialEq, Eq, Hash)]
pub enum VariantKind {
    /// Video poster frame.
    Poster,
    /// 64 px thumbnail.
    Thumb64,
    /// 256 px avatar.
    Avatar256,
    /// 400 px wide card.
    Card400,
    /// 800x600 feed image.
    Feed800x600,
    /// 1080x1350 story image.
    Story1080x1350,
    /// Not known to this build (never chosen for display).
    Unknown,
}

/// A derived rendition of a file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Variant {
    /// Which rendition.
    pub kind: VariantKind,
    /// Short-lived presigned GET URL.
    pub url: SecretUrl,
    /// Content type (empty for on-demand renditions).
    pub content_type: String,
    /// Pixel width (0 when unknown).
    pub width: i32,
    /// Pixel height (0 when unknown).
    pub height: i32,
    /// Size in bytes (0 when unknown).
    pub size_bytes: i64,
}

/// One uploaded file.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Media {
    /// Server id.
    pub id: String,
    /// Kind.
    pub kind: MediaKind,
    /// Status.
    pub status: MediaStatus,
    /// Display name.
    pub filename: String,
    /// Declared content type.
    pub content_type: String,
    /// Size in bytes.
    pub size_bytes: i64,
    /// Pixel width (0 when unknown).
    pub width: i32,
    /// Pixel height (0 when unknown).
    pub height: i32,
    /// Video and audio length in milliseconds.
    pub duration_ms: i64,
    /// Presigned GET URL of the original; empty until ready.
    pub url: SecretUrl,
    /// Renditions.
    pub variants: Vec<Variant>,
    /// The task this file is attached to.
    pub task_id: Option<String>,
    /// Unix seconds, 0 when unknown.
    pub created_at: i64,
    /// Set when `status` is `Failed`.
    pub failure: Option<FailureKind>,
}

/// What the list asks for.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MediaQuery {
    /// Only this task's attachments.
    pub task_id: Option<String>,
    /// Only these kinds (empty: all). `Unknown` is never sent.
    pub kinds: Vec<MediaKind>,
    /// The token of the page to load, echoed exactly as the server sent it.
    pub page_token: Option<String>,
}

/// One page of the list.
#[derive(Clone, Debug, Default, PartialEq, Eq)]
pub struct MediaPage {
    /// The files, newest first.
    pub items: Vec<Media>,
    /// The next page, when there is one.
    pub next_page_token: Option<String>,
}
