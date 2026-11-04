//! What the library screen shows. Plain data, no UI types: the Slint glue copies it into the view.

use aedst_common::ErrorKind;

use crate::domain::{
    Cleanup, FailureKind, FailureReason, Media, MediaKind, MediaStatus, UploadStage,
};

/// One row of the library.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct Row {
    /// Server id.
    pub id: String,
    /// Kind (`Unknown` renders a neutral label).
    pub kind: MediaKind,
    /// Status (uploading / processing / ready / failed; `Unknown` renders a neutral badge).
    pub status: MediaStatus,
    /// Display name.
    pub filename: String,
    /// Size in bytes.
    pub size_bytes: i64,
    /// Why a failed file failed, as a kind (never the server's text).
    pub failure: Option<FailureKind>,
    /// The viewer can open this row (ready images, and videos for the placeholder).
    pub openable: bool,
}

impl Row {
    /// A row for a file the server knows.
    #[must_use]
    pub fn from_media(media: &Media) -> Self {
        Self {
            id: media.id.clone(),
            kind: media.kind,
            status: media.status,
            filename: media.filename.clone(),
            size_bytes: media.size_bytes,
            failure: media.failure,
            openable: media.status == MediaStatus::Ready
                && matches!(media.kind, MediaKind::Image | MediaKind::Video),
        }
    }
}

/// Where loading stands.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Phase {
    /// Nothing requested yet.
    Idle,
    /// The first page is loading.
    Loading,
    /// Rows are shown (possibly none: the empty state).
    Ready,
    /// The first page failed; show the translated message of this kind and a retry.
    Failed(ErrorKind),
}

/// The state of the upload.
#[derive(Clone, Debug, PartialEq, Eq)]
pub enum UploadView {
    /// Nothing running and nothing to report.
    Idle,
    /// An upload is in flight.
    Running {
        /// The file's name.
        file_name: String,
        /// The current step.
        stage: UploadStage,
        /// Bytes sent (meaningful while uploading).
        sent: u64,
        /// Bytes in total.
        total: u64,
    },
    /// The last upload failed; nothing is hidden: the step, the reason and the cleanup result.
    Failed {
        /// The file's name.
        file_name: String,
        /// The step that failed.
        stage: UploadStage,
        /// Why.
        reason: FailureReason,
        /// What became of the record the server had created.
        cleanup: Cleanup,
    },
}

impl UploadView {
    /// Whole percent sent, 0 when the total is unknown.
    #[must_use]
    pub fn percent(&self) -> u8 {
        match self {
            Self::Running { sent, total, .. } if *total > 0 => {
                u8::try_from((u128::from(*sent) * 100 / u128::from(*total)).min(100)).unwrap_or(100)
            }
            _ => 0,
        }
    }
}

/// Everything the screen needs.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct LibraryView {
    /// Rows, newest first.
    pub rows: Vec<Row>,
    /// Loading phase.
    pub phase: Phase,
    /// A next page exists.
    pub has_more: bool,
    /// A further page is loading.
    pub loading_more: bool,
    /// Some file is still uploading or processing: the shell polls while this is true.
    pub unfinished: bool,
    /// The row whose delete awaits confirmation.
    pub confirm_delete: Option<String>,
    /// A delete request is in flight.
    pub deleting: bool,
    /// The upload's state.
    pub upload: UploadView,
    /// A delete or a later page failed; `Cancelled` is never stored.
    pub action_error: Option<ErrorKind>,
}

impl Default for LibraryView {
    fn default() -> Self {
        Self {
            rows: Vec::new(),
            phase: Phase::Idle,
            has_more: false,
            loading_more: false,
            unfinished: false,
            confirm_delete: None,
            deleting: false,
            upload: UploadView::Idle,
            action_error: None,
        }
    }
}
