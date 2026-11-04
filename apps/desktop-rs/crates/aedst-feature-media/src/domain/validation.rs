//! Client-side checks that mirror the contract (`media.proto` and the server allow-list), so a
//! refusal costs no request. The server stays the authority: its limits are configurable and the
//! values here are its defaults.

use super::{media::MediaKind, ports::PickedFile};

/// Default server limit for images (`AEDST_MEDIA_MAX_IMAGE_BYTES`).
pub const MAX_IMAGE_BYTES: u64 = 20 * 1024 * 1024;
/// Default server limit for videos.
pub const MAX_VIDEO_BYTES: u64 = 500 * 1024 * 1024;
/// Default server limit for audio.
pub const MAX_AUDIO_BYTES: u64 = 100 * 1024 * 1024;
/// Default server limit for documents.
pub const MAX_DOCUMENT_BYTES: u64 = 50 * 1024 * 1024;
/// `CreateUploadRequest.filename` max length.
pub const MAX_FILENAME_CHARS: usize = 255;
const CONTENT_TYPE_LEN: std::ops::RangeInclusive<usize> = 3..=127;

/// Why a file was refused before any request.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum ValidationError {
    /// The file is empty.
    Empty,
    /// The file is larger than the limit of its kind.
    TooLarge(MediaKind),
    /// The content type is not on the allow-list.
    UnsupportedType,
    /// The file name is empty or longer than 255 characters.
    BadFilename,
    /// The task id is not a UUID.
    BadTask,
}

impl ValidationError {
    /// Stable key used by the UI.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::Empty => "empty",
            Self::TooLarge(_) => "tooLarge",
            Self::UnsupportedType => "unsupportedType",
            Self::BadFilename => "badFilename",
            Self::BadTask => "badTask",
        }
    }
}

/// The kind the server allow-list assigns to a content type (parameters and case ignored), or
/// `None` when the type is not allowed. SVG and HTML are deliberately absent.
#[must_use]
pub fn kind_for_content_type(content_type: &str) -> Option<MediaKind> {
    let essence = content_type.split(';').next().unwrap_or("").trim();
    match essence.to_ascii_lowercase().as_str() {
        "image/jpeg" | "image/png" | "image/gif" | "image/webp" => Some(MediaKind::Image),
        "video/mp4" | "video/webm" | "video/quicktime" => Some(MediaKind::Video),
        "audio/mpeg" | "audio/mp4" | "audio/ogg" | "audio/wav" | "audio/webm" => {
            Some(MediaKind::Audio)
        }
        "application/pdf" | "text/plain" => Some(MediaKind::Document),
        _ => None,
    }
}

fn limit(kind: MediaKind) -> u64 {
    match kind {
        MediaKind::Image => MAX_IMAGE_BYTES,
        MediaKind::Video => MAX_VIDEO_BYTES,
        MediaKind::Audio => MAX_AUDIO_BYTES,
        MediaKind::Document | MediaKind::Unknown => MAX_DOCUMENT_BYTES,
    }
}

/// Checks a picked file (and the optional task id) against the contract.
///
/// # Errors
/// The first [`ValidationError`] that applies.
pub fn validate_file(
    file: &PickedFile,
    task_id: Option<&str>,
) -> Result<MediaKind, ValidationError> {
    let name_chars = file.file_name.trim().chars().count();
    if name_chars == 0 || name_chars > MAX_FILENAME_CHARS {
        return Err(ValidationError::BadFilename);
    }
    if file.size == 0 {
        return Err(ValidationError::Empty);
    }
    if !CONTENT_TYPE_LEN.contains(&file.content_type.len()) {
        return Err(ValidationError::UnsupportedType);
    }
    let kind = kind_for_content_type(&file.content_type).ok_or(ValidationError::UnsupportedType)?;
    if file.size > limit(kind) {
        return Err(ValidationError::TooLarge(kind));
    }
    if let Some(id) = task_id
        && uuid::Uuid::parse_str(id).is_err()
    {
        return Err(ValidationError::BadTask);
    }
    Ok(kind)
}
