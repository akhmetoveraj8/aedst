//! Runs the Media screens against an in-memory repository (no server, no network):
//! `cargo run -p aedst-feature-media --example media_demo -- [--lang ru|tg|uz|ar] [--dark] [--offline] [--empty]
//! [--upload] [--confirm] [--viewer] [--video] [--snapshot <file.png>]`.
//!
//! `--offline` makes uploads and deletes fail as offline. `--upload` starts a slow fake upload so the
//! progress bar is visible; `--confirm` asks to confirm the delete of the first row; `--viewer`
//! opens the first image (a generated gradient stands in for the download); `--video` opens the
//! video placeholder. `--snapshot <file.png>` renders the window once, saves it and exits.

use std::{
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
    time::Duration,
};

use aedst_common::ErrorKind;
use aedst_feature_media::{
    domain::{
        FailureKind, FilePicker, ImageFetcher, Media, MediaKind, MediaPage, MediaQuery,
        MediaRepository, MediaStatus, NewUpload, ObjectUploader, OnBytes, PickedFile, SecretUrl,
        UploadService, UploadTarget, UploadTicket,
    },
    presentation::{LibraryController, ViewerController},
    ui_glue::{MediaDemoWindow, bind, language_is_rtl, select_language},
};
use futures::future::BoxFuture;
use slint::ComponentHandle;

struct Memory {
    items: Mutex<Vec<Media>>,
    offline: bool,
    next: AtomicUsize,
}

fn media(id: &str, name: &str, kind: MediaKind, status: MediaStatus, bytes: i64) -> Media {
    Media {
        id: id.into(),
        kind,
        status,
        filename: name.into(),
        content_type: String::new(),
        size_bytes: bytes,
        width: 640,
        height: 400,
        duration_ms: 0,
        url: SecretUrl::new(format!("https://demo.invalid/{id}?sig=demo")),
        variants: Vec::new(),
        task_id: None,
        created_at: 0,
        failure: None,
    }
}

fn sample() -> Vec<Media> {
    let mut broken = media(
        "e",
        "scan.png",
        MediaKind::Image,
        MediaStatus::Failed,
        88_000,
    );
    broken.failure = Some(FailureKind::TypeMismatch);
    vec![
        media(
            "a",
            "sunrise.png",
            MediaKind::Image,
            MediaStatus::Ready,
            2_400_000,
        ),
        media(
            "b",
            "team-clip.mp4",
            MediaKind::Video,
            MediaStatus::Ready,
            48_000_000,
        ),
        media(
            "c",
            "report.pdf",
            MediaKind::Document,
            MediaStatus::Processing,
            640_000,
        ),
        media(
            "d",
            "voice-note.mp3",
            MediaKind::Audio,
            MediaStatus::Ready,
            900,
        ),
        broken,
        media(
            "f",
            "الصورة.png",
            MediaKind::Image,
            MediaStatus::PendingUpload,
            12_000,
        ),
    ]
}

impl MediaRepository for Memory {
    fn list<'a>(&'a self, _: &'a MediaQuery) -> BoxFuture<'a, Result<MediaPage, ErrorKind>> {
        Box::pin(async move {
            let mut items = self.items.lock().map_err(|_| ErrorKind::Unknown)?;
            // A file the user just uploaded finishes processing on the next read.
            for m in items.iter_mut().filter(|m| m.id.starts_with("up-")) {
                m.status = MediaStatus::Ready;
            }
            Ok(MediaPage {
                items: items.clone(),
                next_page_token: None,
            })
        })
    }

    fn get<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Media, ErrorKind>> {
        Box::pin(async move {
            let items = self.items.lock().map_err(|_| ErrorKind::Unknown)?;
            items
                .iter()
                .find(|m| m.id == id)
                .cloned()
                .ok_or(ErrorKind::NotFound)
        })
    }

    fn create_upload<'a>(
        &'a self,
        new: &'a NewUpload,
    ) -> BoxFuture<'a, Result<UploadTicket, ErrorKind>> {
        Box::pin(async move {
            if self.offline {
                return Err(ErrorKind::Offline);
            }
            let id = format!("up-{}", self.next.fetch_add(1, Ordering::SeqCst));
            let pending = media(
                &id,
                &new.filename,
                MediaKind::Image,
                MediaStatus::PendingUpload,
                i64::try_from(new.size_bytes).unwrap_or(0),
            );
            self.items
                .lock()
                .map_err(|_| ErrorKind::Unknown)?
                .insert(0, pending.clone());
            Ok(UploadTicket {
                media: pending,
                target: UploadTarget {
                    url: SecretUrl::new("https://demo.invalid/put?sig=demo"),
                    method: "PUT".into(),
                    headers: Vec::new(),
                    expires_at: None,
                },
            })
        })
    }

    fn complete_upload<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Media, ErrorKind>> {
        Box::pin(async move {
            let mut items = self.items.lock().map_err(|_| ErrorKind::Unknown)?;
            let item = items
                .iter_mut()
                .find(|m| m.id == id)
                .ok_or(ErrorKind::NotFound)?;
            item.status = MediaStatus::Processing;
            Ok(item.clone())
        })
    }

    fn delete<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async move {
            if self.offline {
                return Err(ErrorKind::Offline);
            }
            self.items
                .lock()
                .map_err(|_| ErrorKind::Unknown)?
                .retain(|m| m.id != id);
            Ok(())
        })
    }
}

/// Pretends to upload: twenty steps, 250 ms each.
struct SlowUploader;

impl ObjectUploader for SlowUploader {
    fn upload<'a>(
        &'a self,
        _: &'a UploadTarget,
        file: &'a PickedFile,
        progress: OnBytes,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        Box::pin(async move {
            for step in 1..=20_u64 {
                tokio::time::sleep(Duration::from_millis(250)).await;
                progress(file.size * step / 20, file.size);
            }
            Ok(())
        })
    }
}

struct DemoPicker;

impl FilePicker for DemoPicker {
    fn pick(&self) -> BoxFuture<'_, Result<Option<PickedFile>, ErrorKind>> {
        Box::pin(async {
            Ok(Some(PickedFile {
                path: "holiday-photo.png".into(),
                file_name: "holiday-photo.png".into(),
                content_type: "image/png".into(),
                size: 3_400_000,
            }))
        })
    }
}

/// "Downloads" a generated gradient so the viewer has something to show.
struct GradientFetcher;

impl ImageFetcher for GradientFetcher {
    fn fetch<'a>(&'a self, _: &'a SecretUrl, _: u64) -> BoxFuture<'a, Result<Vec<u8>, ErrorKind>> {
        Box::pin(async {
            let picture = image::RgbaImage::from_fn(640, 400, |x, y| {
                let (r, g) = (u8::try_from(x * 255 / 639), u8::try_from(y * 255 / 399));
                image::Rgba([r.unwrap_or(255), g.unwrap_or(255), 160, 255])
            });
            let mut bytes = Vec::new();
            picture
                .write_to(
                    &mut std::io::Cursor::new(&mut bytes),
                    image::ImageFormat::Png,
                )
                .map_err(|_| ErrorKind::Unknown)?;
            Ok(bytes)
        })
    }
}

fn main() -> Result<(), Box<dyn std::error::Error>> {
    let args: Vec<String> = std::env::args().collect();
    let flag = |name: &str| args.iter().any(|a| a == name);
    let lang = args
        .iter()
        .position(|a| a == "--lang")
        .and_then(|i| args.get(i + 1))
        .map_or("en", String::as_str);

    let runtime = tokio::runtime::Builder::new_multi_thread()
        .enable_all()
        .build()?;
    let repository = Arc::new(Memory {
        items: Mutex::new(if flag("--empty") {
            Vec::new()
        } else {
            sample()
        }),
        offline: flag("--offline"),
        next: AtomicUsize::new(0),
    });
    let uploads = Arc::new(UploadService::new(
        repository.clone(),
        Arc::new(SlowUploader),
    ));
    let library = LibraryController::new(repository, uploads, Arc::new(DemoPicker));
    let viewer = ViewerController::new(Arc::new(GradientFetcher));

    let ui = MediaDemoWindow::new()?;
    select_language(lang)?;
    ui.set_rtl(language_is_rtl(lang));
    ui.set_dark(flag("--dark"));
    bind(&ui, &library, &viewer, runtime.handle());
    runtime.spawn({
        let (library, viewer) = (Arc::clone(&library), Arc::clone(&viewer));
        let (upload, confirm, open_image, open_video) = (
            flag("--upload"),
            flag("--confirm"),
            flag("--viewer"),
            flag("--video"),
        );
        async move {
            library.load_first().await;
            if confirm {
                library.request_delete("a");
            }
            if open_image && let Some(m) = library.media("a") {
                viewer.open(&m).await;
            }
            if open_video && let Some(m) = library.media("b") {
                viewer.open(&m).await;
            }
            if upload {
                library.pick_and_upload().await;
            }
        }
    });
    if let Some(path) = args
        .iter()
        .position(|a| a == "--snapshot")
        .and_then(|i| args.get(i + 1))
        .cloned()
    {
        let weak = ui.as_weak();
        slint::Timer::single_shot(Duration::from_millis(2500), move || {
            if let Some(ui) = weak.upgrade()
                && let Ok(buffer) = ui.window().take_snapshot()
            {
                let _ = image::save_buffer(
                    &path,
                    buffer.as_bytes(),
                    buffer.width(),
                    buffer.height(),
                    image::ColorType::Rgba8,
                );
            }
            let _ = slint::quit_event_loop();
        });
    }
    ui.run()?;
    Ok(())
}
