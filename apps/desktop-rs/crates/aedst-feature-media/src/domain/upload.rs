//! The upload use case: validate, `CreateUpload`, PUT to the presigned URL, `CompleteUpload`.
//!
//! Uploads are not queued offline. Every failure after `CreateUpload` tries to delete the record
//! it created and says whether that worked, so no half-uploaded state is hidden from the user.

use std::sync::Arc;

use aedst_common::ErrorKind;

use super::{
    media::Media,
    ports::{MediaRepository, NewUpload, ObjectUploader, OnBytes, PickedFile},
    validation::{ValidationError, validate_file},
};

/// Which step of the upload is running or failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UploadStage {
    /// Checking the file against the contract (no request yet).
    Validating,
    /// Asking for the presigned URL.
    Creating,
    /// Sending the bytes to object storage.
    Uploading,
    /// Telling the server the object is there.
    Completing,
}

impl UploadStage {
    /// Stable key used by the UI.
    #[must_use]
    pub fn key(self) -> &'static str {
        match self {
            Self::Validating => "validating",
            Self::Creating => "creating",
            Self::Uploading => "uploading",
            Self::Completing => "completing",
        }
    }
}

/// What the use case reports while it runs.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum UploadEvent {
    /// A new step began.
    Stage(UploadStage),
    /// Bytes sent so far of the total.
    Bytes {
        /// Sent.
        sent: u64,
        /// Total.
        total: u64,
    },
}

/// Why an upload failed.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum FailureReason {
    /// Refused before any request.
    Invalid(ValidationError),
    /// A request or the transfer failed.
    Kind(ErrorKind),
}

/// What became of the record `CreateUpload` made.
#[derive(Clone, Copy, Debug, PartialEq, Eq)]
pub enum Cleanup {
    /// Nothing was created.
    NotNeeded,
    /// The orphan record was deleted.
    Removed,
    /// Deleting failed: an unfinished record may stay on the server until it expires.
    Failed,
}

/// A failed upload: where it stopped, why, and what was cleaned up.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UploadFailure {
    /// The step that failed.
    pub stage: UploadStage,
    /// Why.
    pub reason: FailureReason,
    /// The id `CreateUpload` returned, when it got that far.
    pub media_id: Option<String>,
    /// Outcome of the best-effort delete of that record.
    pub cleanup: Cleanup,
}

/// Upload use case over the ports.
pub struct UploadService {
    repository: Arc<dyn MediaRepository>,
    uploader: Arc<dyn ObjectUploader>,
}

impl UploadService {
    /// A service over the repository and the uploader.
    #[must_use]
    pub fn new(repository: Arc<dyn MediaRepository>, uploader: Arc<dyn ObjectUploader>) -> Self {
        Self {
            repository,
            uploader,
        }
    }

    /// Uploads `file`, optionally attached to `task_id`. `on_event` reports steps and bytes.
    ///
    /// # Errors
    /// An [`UploadFailure`] naming the step, the reason and the cleanup result.
    pub async fn upload(
        &self,
        file: &PickedFile,
        task_id: Option<&str>,
        on_event: Arc<dyn Fn(UploadEvent) + Send + Sync>,
    ) -> Result<Media, UploadFailure> {
        on_event(UploadEvent::Stage(UploadStage::Validating));
        validate_file(file, task_id).map_err(|e| UploadFailure {
            stage: UploadStage::Validating,
            reason: FailureReason::Invalid(e),
            media_id: None,
            cleanup: Cleanup::NotNeeded,
        })?;

        on_event(UploadEvent::Stage(UploadStage::Creating));
        let new = NewUpload {
            filename: file.file_name.trim().to_owned(),
            content_type: file.content_type.clone(),
            size_bytes: file.size,
            task_id: task_id.map(str::to_owned),
        };
        let ticket = self
            .repository
            .create_upload(&new)
            .await
            .map_err(|kind| UploadFailure {
                stage: UploadStage::Creating,
                reason: FailureReason::Kind(kind),
                media_id: None,
                cleanup: Cleanup::NotNeeded,
            })?;
        let id = ticket.media.id.clone();

        on_event(UploadEvent::Stage(UploadStage::Uploading));
        let progress: OnBytes = {
            let on_event = Arc::clone(&on_event);
            Arc::new(move |sent, total| on_event(UploadEvent::Bytes { sent, total }))
        };
        if let Err(kind) = self.uploader.upload(&ticket.target, file, progress).await {
            return Err(self.fail(UploadStage::Uploading, kind, id).await);
        }

        on_event(UploadEvent::Stage(UploadStage::Completing));
        match self.repository.complete_upload(&id).await {
            Ok(media) => Ok(media),
            Err(kind) => Err(self.fail(UploadStage::Completing, kind, id).await),
        }
    }

    async fn fail(&self, stage: UploadStage, kind: ErrorKind, id: String) -> UploadFailure {
        let cleanup = match self.repository.delete(&id).await {
            Ok(()) => Cleanup::Removed,
            Err(_) => Cleanup::Failed,
        };
        UploadFailure {
            stage,
            reason: FailureReason::Kind(kind),
            media_id: Some(id),
            cleanup,
        }
    }
}
