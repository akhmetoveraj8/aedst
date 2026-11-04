//! Domain layer: pure model, validation, ports and the upload use case. No wire types, no UI.

pub mod media;
pub mod ports;
pub mod upload;
pub mod validation;
pub mod variant;

pub use media::{
    FailureKind, Media, MediaKind, MediaPage, MediaQuery, MediaStatus, PAGE_SIZE, SecretUrl,
    Variant, VariantKind,
};
pub use ports::{
    FilePicker, ImageFetcher, MediaRepository, NewUpload, ObjectUploader, OnBytes, PickedFile,
    UploadTarget, UploadTicket,
};
pub use upload::{Cleanup, FailureReason, UploadEvent, UploadFailure, UploadService, UploadStage};
pub use validation::{
    MAX_AUDIO_BYTES, MAX_DOCUMENT_BYTES, MAX_FILENAME_CHARS, MAX_IMAGE_BYTES, MAX_VIDEO_BYTES,
    ValidationError, kind_for_content_type, validate_file,
};
pub use variant::{Purpose, select_variant};
