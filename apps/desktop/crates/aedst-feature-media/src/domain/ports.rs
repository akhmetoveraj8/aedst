//! What the domain needs from the outside world. `data` implements these (the picker comes from
//! the shell); tests use fakes.

use std::{path::PathBuf, sync::Arc};

use aedst_common::ErrorKind;
use futures::future::BoxFuture;

use super::media::{Media, MediaPage, MediaQuery, SecretUrl};

/// Called with `(bytes sent, total bytes)` while a file is transferred.
pub type OnBytes = Arc<dyn Fn(u64, u64) + Send + Sync>;

/// A file the user chose. The shell's native picker (or a drop target) produces it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct PickedFile {
    /// Where the bytes are.
    pub path: PathBuf,
    /// The display name sent to the server.
    pub file_name: String,
    /// The content type the shell determined (by extension or sniffing).
    pub content_type: String,
    /// Size in bytes at the time of picking.
    pub size: u64,
}

/// What `CreateUpload` is asked for.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct NewUpload {
    /// Display name, 1..=255 characters.
    pub filename: String,
    /// Declared content type.
    pub content_type: String,
    /// Size in bytes, greater than zero.
    pub size_bytes: u64,
    /// Attach to this task.
    pub task_id: Option<String>,
}

/// Where and how to send the bytes. The URL is a credential: never log it.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UploadTarget {
    /// Presigned URL.
    pub url: SecretUrl,
    /// HTTP method (`PUT` today).
    pub method: String,
    /// Headers to send verbatim.
    pub headers: Vec<(String, String)>,
    /// Unix seconds when the URL stops working, when known.
    pub expires_at: Option<i64>,
}

/// The answer of `CreateUpload`.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct UploadTicket {
    /// The new record (status pending upload).
    pub media: Media,
    /// How to send the bytes.
    pub target: UploadTarget,
}

/// The server side of Media. Writes carry an `Idempotency-Key` made by the implementation.
pub trait MediaRepository: Send + Sync {
    /// One page of the library.
    fn list<'a>(&'a self, query: &'a MediaQuery) -> BoxFuture<'a, Result<MediaPage, ErrorKind>>;
    /// One file.
    fn get<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Media, ErrorKind>>;
    /// Asks for a presigned upload URL.
    fn create_upload<'a>(
        &'a self,
        new: &'a NewUpload,
    ) -> BoxFuture<'a, Result<UploadTicket, ErrorKind>>;
    /// Tells the server the object is in storage; processing starts.
    fn complete_upload<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Media, ErrorKind>>;
    /// Deletes a file.
    fn delete<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<(), ErrorKind>>;
}

/// The native file dialog, supplied by the shell.
pub trait FilePicker: Send + Sync {
    /// Asks the user for a file. `Ok(None)` means the user cancelled.
    fn pick(&self) -> BoxFuture<'_, Result<Option<PickedFile>, ErrorKind>>;
}

/// Sends the file's bytes to the presigned URL. No redirects, no credentials in errors.
pub trait ObjectUploader: Send + Sync {
    /// Streams `file` to `target`, reporting progress. Any non-2xx answer or transport failure is
    /// an error kind; `Forbidden` means the URL expired or was refused.
    fn upload<'a>(
        &'a self,
        target: &'a UploadTarget,
        file: &'a PickedFile,
        progress: OnBytes,
    ) -> BoxFuture<'a, Result<(), ErrorKind>>;
}

/// Downloads an image (a variant or an original) for display.
pub trait ImageFetcher: Send + Sync {
    /// Returns the bytes, failing as soon as more than `max_bytes` arrive.
    fn fetch<'a>(
        &'a self,
        url: &'a SecretUrl,
        max_bytes: u64,
    ) -> BoxFuture<'a, Result<Vec<u8>, ErrorKind>>;
}
