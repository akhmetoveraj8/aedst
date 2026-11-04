//! The library's view model: owns the state, calls the ports and use cases, publishes a
//! [`LibraryView`].
//!
//! No UI types: the Slint glue subscribes to [`LibraryController::subscribe`]. A response that
//! belongs to an older load (the user reloaded meanwhile) is discarded, and `Cancelled` never
//! shows an error. Uploads are not queued: a failed upload stays visible until dismissed.

use std::sync::{
    Arc, Mutex, PoisonError,
    atomic::{AtomicU8, Ordering},
};

use aedst_common::ErrorKind;
use tokio::sync::watch;

use super::list_state::{LibraryView, Phase, Row, UploadView};
use crate::domain::{
    FilePicker, Media, MediaQuery, MediaRepository, PickedFile, UploadEvent, UploadService,
    UploadStage,
};

#[derive(Default)]
struct Inner {
    view: LibraryView,
    items: Vec<Media>,
    next_token: Option<String>,
    task_id: Option<String>,
    /// Bumped by every first-page load; a result carrying an older value is dropped.
    epoch: u64,
}

impl Inner {
    fn rebuild_rows(&mut self) {
        self.view.rows = self.items.iter().map(Row::from_media).collect();
        self.view.unfinished = self.items.iter().any(|m| m.status.unfinished());
    }
}

/// Drives the Media library screen.
pub struct LibraryController {
    repository: Arc<dyn MediaRepository>,
    uploads: Arc<UploadService>,
    picker: Arc<dyn FilePicker>,
    inner: Mutex<Inner>,
    published: watch::Sender<LibraryView>,
}

impl LibraryController {
    /// A controller over the repository, the upload use case and the shell's file picker.
    #[must_use]
    pub fn new(
        repository: Arc<dyn MediaRepository>,
        uploads: Arc<UploadService>,
        picker: Arc<dyn FilePicker>,
    ) -> Arc<Self> {
        Arc::new(Self {
            repository,
            uploads,
            picker,
            inner: Mutex::new(Inner::default()),
            published: watch::channel(LibraryView::default()).0,
        })
    }

    /// The UI subscribes here.
    #[must_use]
    pub fn subscribe(&self) -> watch::Receiver<LibraryView> {
        self.published.subscribe()
    }

    fn update<T>(&self, work: impl FnOnce(&mut Inner) -> T) -> T {
        let mut inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        let result = work(&mut inner);
        let view = inner.view.clone();
        drop(inner);
        self.published.send_replace(view);
        result
    }

    /// The full record of a listed file (the viewer needs its variants), if it is still listed.
    #[must_use]
    pub fn media(&self, id: &str) -> Option<Media> {
        let inner = self.inner.lock().unwrap_or_else(PoisonError::into_inner);
        inner.items.iter().find(|m| m.id == id).cloned()
    }

    /// Shows only this task's attachments (`None`: the whole library). Call `load_first` after.
    pub fn set_task_filter(&self, task_id: Option<String>) {
        self.update(|i| i.task_id = task_id);
    }

    /// Loads (or reloads) the first page. Safe to call again: only the latest call wins.
    pub async fn load_first(&self) {
        let (epoch, query) = self.update(|i| {
            i.epoch += 1;
            i.view.phase = Phase::Loading;
            i.view.action_error = None;
            (i.epoch, self.query(i, None))
        });
        let result = self.repository.list(&query).await;
        self.update(|i| {
            if i.epoch != epoch {
                return; // a newer load started while this one was in flight
            }
            match result {
                Ok(page) => {
                    i.items = page.items;
                    i.view.has_more = page.next_page_token.is_some();
                    i.next_token = page.next_page_token;
                    i.rebuild_rows();
                    i.view.phase = Phase::Ready;
                }
                Err(ErrorKind::Cancelled) => i.view.phase = Phase::Idle,
                Err(kind) => i.view.phase = Phase::Failed(kind),
            }
        });
    }

    fn query(&self, inner: &Inner, page_token: Option<String>) -> MediaQuery {
        MediaQuery {
            task_id: inner.task_id.clone(),
            kinds: Vec::new(),
            page_token,
        }
    }

    /// Loads the next page, if there is one and none is loading.
    pub async fn load_more(&self) {
        let started = self.update(|i| {
            let token = i.next_token.clone()?;
            if i.view.loading_more || i.view.phase != Phase::Ready {
                return None;
            }
            i.view.loading_more = true;
            Some((i.epoch, self.query(i, Some(token))))
        });
        let Some((epoch, query)) = started else {
            return;
        };
        let result = self.repository.list(&query).await;
        self.update(|i| {
            if i.epoch != epoch {
                return;
            }
            i.view.loading_more = false;
            match result {
                Ok(page) => {
                    i.items.extend(page.items);
                    i.view.has_more = page.next_page_token.is_some();
                    i.next_token = page.next_page_token;
                    i.rebuild_rows();
                }
                Err(ErrorKind::Cancelled) => {}
                Err(kind) => i.view.action_error = Some(kind),
            }
        });
    }

    /// Re-reads the first page without a loading state and merges it in: known files are updated
    /// in place (so processing turns into ready), new ones go on top, later pages stay. Failures
    /// are ignored; the next poll tries again.
    pub async fn refresh(&self) {
        let started =
            self.update(|i| (i.view.phase == Phase::Ready).then(|| (i.epoch, self.query(i, None))));
        let Some((epoch, query)) = started else {
            return;
        };
        let Ok(page) = self.repository.list(&query).await else {
            return;
        };
        self.update(|i| {
            if i.epoch != epoch {
                return;
            }
            let mut fresh = Vec::new();
            for media in page.items {
                match i.items.iter_mut().find(|m| m.id == media.id) {
                    Some(existing) => *existing = media,
                    None => fresh.push(media),
                }
            }
            i.items.splice(0..0, fresh);
            i.rebuild_rows();
        });
    }

    /// One poll step: refreshes while a file is unfinished. Returns whether polling should go on.
    pub async fn poll_unfinished(&self) -> bool {
        if !self.subscribe().borrow().unfinished {
            return false;
        }
        self.refresh().await;
        self.subscribe().borrow().unfinished
    }

    /// Asks for the delete of `id` to be confirmed. Nothing is sent yet.
    pub fn request_delete(&self, id: &str) {
        self.update(|i| {
            if i.items.iter().any(|m| m.id == id) && !i.view.deleting {
                i.view.confirm_delete = Some(id.to_owned());
                i.view.action_error = None;
            }
        });
    }

    /// Backs out of a pending delete.
    pub fn cancel_delete(&self) {
        self.update(|i| {
            if !i.view.deleting {
                i.view.confirm_delete = None;
            }
        });
    }

    /// Deletes the file that awaits confirmation. Without a pending confirmation it does nothing.
    pub async fn confirm_delete(&self) {
        let Some(id) = self.update(|i| {
            let id = i.view.confirm_delete.clone()?;
            if i.view.deleting {
                return None;
            }
            i.view.deleting = true;
            Some(id)
        }) else {
            return;
        };
        let result = self.repository.delete(&id).await;
        self.update(|i| {
            i.view.deleting = false;
            i.view.confirm_delete = None;
            match result {
                Ok(()) => {
                    i.items.retain(|m| m.id != id);
                    i.rebuild_rows();
                }
                Err(ErrorKind::Cancelled) => {}
                Err(kind) => i.view.action_error = Some(kind),
            }
        });
    }

    /// Clears the report of a failed upload.
    pub fn dismiss_upload(&self) {
        self.update(|i| {
            if matches!(i.view.upload, UploadView::Failed { .. }) {
                i.view.upload = UploadView::Idle;
            }
        });
    }

    /// Opens the native picker and uploads the chosen file. A cancelled dialog does nothing.
    pub async fn pick_and_upload(self: &Arc<Self>) {
        if self.upload_running() {
            return;
        }
        match self.picker.pick().await {
            Ok(Some(file)) => self.upload_file(file).await,
            Ok(None) | Err(ErrorKind::Cancelled) => {}
            Err(kind) => self.update(|i| i.view.action_error = Some(kind)),
        }
    }

    fn upload_running(&self) -> bool {
        matches!(self.subscribe().borrow().upload, UploadView::Running { .. })
    }

    /// Uploads `file` (from the picker or a drop). One upload runs at a time; a second request
    /// while one runs is ignored.
    pub async fn upload_file(self: &Arc<Self>, file: PickedFile) {
        let task_id = self.update(|i| {
            if matches!(i.view.upload, UploadView::Running { .. }) {
                return None;
            }
            i.view.upload = UploadView::Running {
                file_name: file.file_name.clone(),
                stage: UploadStage::Validating,
                sent: 0,
                total: file.size,
            };
            Some(i.task_id.clone())
        });
        let Some(task_id) = task_id else {
            return;
        };

        // Publish a new view only when the whole percent changes, not on every 256 KiB chunk.
        let last_percent = Arc::new(AtomicU8::new(u8::MAX));
        let on_event = {
            let (this, name, total, last) = (
                Arc::clone(self),
                file.file_name.clone(),
                file.size,
                Arc::clone(&last_percent),
            );
            Arc::new(move |event: UploadEvent| {
                let view = match event {
                    UploadEvent::Stage(stage) => UploadView::Running {
                        file_name: name.clone(),
                        stage,
                        sent: 0,
                        total,
                    },
                    UploadEvent::Bytes { sent, total } => {
                        let view = UploadView::Running {
                            file_name: name.clone(),
                            stage: UploadStage::Uploading,
                            sent,
                            total,
                        };
                        if last.swap(view.percent(), Ordering::SeqCst) == view.percent() {
                            return;
                        }
                        view
                    }
                };
                this.update(|i| i.view.upload = view);
            })
        };

        let result = self
            .uploads
            .upload(&file, task_id.as_deref(), on_event)
            .await;
        match result {
            Ok(media) => {
                self.update(|i| {
                    i.view.upload = UploadView::Idle;
                    if i.view.phase == Phase::Ready && !i.items.iter().any(|m| m.id == media.id) {
                        i.items.insert(0, media);
                        i.rebuild_rows();
                    }
                });
                self.refresh().await;
            }
            Err(failure) => self.update(|i| {
                i.view.upload =
                    if failure.reason == crate::domain::FailureReason::Kind(ErrorKind::Cancelled) {
                        UploadView::Idle
                    } else {
                        UploadView::Failed {
                            file_name: file.file_name.clone(),
                            stage: failure.stage,
                            reason: failure.reason,
                            cleanup: failure.cleanup,
                        }
                    };
            }),
        }
    }
}
