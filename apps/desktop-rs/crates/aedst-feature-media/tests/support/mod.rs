//! Test doubles for the Media ports.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report
#![allow(dead_code)] // each test file uses a different subset

use std::{
    collections::VecDeque,
    path::PathBuf,
    sync::{Arc, Mutex},
};

use aedst_common::ErrorKind;
use aedst_feature_media::domain::{
    FilePicker, ImageFetcher, Media, MediaKind, MediaPage, MediaQuery, MediaRepository,
    MediaStatus, NewUpload, ObjectUploader, OnBytes, PickedFile, SecretUrl, UploadService,
    UploadTarget, UploadTicket, Variant, VariantKind,
};
use futures::future::BoxFuture;
use tokio::sync::oneshot;

pub fn media(id: &str, kind: MediaKind, status: MediaStatus) -> Media {
    Media {
        id: id.into(),
        kind,
        status,
        filename: format!("{id}.bin"),
        content_type: "image/png".into(),
        size_bytes: 1000,
        width: 100,
        height: 80,
        duration_ms: 0,
        url: SecretUrl::new(format!("https://storage.example/{id}?sig=SECRET")),
        variants: Vec::new(),
        task_id: None,
        created_at: 0,
        failure: None,
    }
}

pub fn image(id: &str) -> Media {
    media(id, MediaKind::Image, MediaStatus::Ready)
}

pub fn with_variant(mut m: Media, kind: VariantKind, w: i32, h: i32) -> Media {
    m.variants.push(Variant {
        kind,
        url: SecretUrl::new(format!(
            "https://storage.example/{}/{kind:?}?sig=SECRET",
            m.id
        )),
        content_type: String::new(),
        width: w,
        height: h,
        size_bytes: 0,
    });
    m
}

pub fn page(ids: &[&str], next: Option<&str>) -> MediaPage {
    MediaPage {
        items: ids.iter().map(|id| image(id)).collect(),
        next_page_token: next.map(String::from),
    }
}

pub fn file(name: &str, content_type: &str, size: u64) -> PickedFile {
    PickedFile {
        path: PathBuf::from(name),
        file_name: name.into(),
        content_type: content_type.into(),
        size,
    }
}

pub fn ticket(id: &str) -> UploadTicket {
    UploadTicket {
        media: media(id, MediaKind::Image, MediaStatus::PendingUpload),
        target: UploadTarget {
            url: SecretUrl::new("https://storage.example/put?sig=SECRET"),
            method: "PUT".into(),
            headers: vec![("x-meta".into(), "1".into())],
            expires_at: None,
        },
    }
}

/// A scripted repository. Calls are recorded in order as short strings.
#[derive(Default)]
pub struct FakeRepo {
    pub pages: Mutex<VecDeque<Result<MediaPage, ErrorKind>>>,
    pub tickets: Mutex<VecDeque<Result<UploadTicket, ErrorKind>>>,
    pub completes: Mutex<VecDeque<Result<Media, ErrorKind>>>,
    pub deletes: Mutex<VecDeque<Result<(), ErrorKind>>>,
    pub calls: Mutex<Vec<String>>,
    pub queries: Mutex<Vec<MediaQuery>>,
    pub created: Mutex<Vec<NewUpload>>,
    /// When set, the next `list` call waits for this gate before answering.
    pub gate: Mutex<Option<oneshot::Receiver<()>>>,
}

impl FakeRepo {
    pub fn calls(&self) -> Vec<String> {
        self.calls.lock().unwrap().clone()
    }
}

impl MediaRepository for FakeRepo {
    fn list<'a>(&'a self, query: &'a MediaQuery) -> BoxFuture<'a, Result<MediaPage, ErrorKind>> {
        self.calls.lock().unwrap().push("list".into());
        self.queries.lock().unwrap().push(query.clone());
        let gate = self.gate.lock().unwrap().take();
        Box::pin(async move {
            if let Some(gate) = gate {
                let _ = gate.await;
            }
            self.pages
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Ok(MediaPage::default()))
        })
    }

    fn get<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Media, ErrorKind>> {
        Box::pin(async move { Ok(image(id)) })
    }

    fn create_upload<'a>(
        &'a self,
        new: &'a NewUpload,
    ) -> BoxFuture<'a, Result<UploadTicket, ErrorKind>> {
        self.calls.lock().unwrap().push("create".into());
        self.created.lock().unwrap().push(new.clone());
        Box::pin(async move {
            self.tickets
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(ticket("new")))
        })
    }

    fn complete_upload<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<Media, ErrorKind>> {
        self.calls.lock().unwrap().push(format!("complete {id}"));
        Box::pin(async move {
            self.completes
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or_else(|| Ok(media(id, MediaKind::Image, MediaStatus::Processing)))
        })
    }

    fn delete<'a>(&'a self, id: &'a str) -> BoxFuture<'a, Result<(), ErrorKind>> {
        self.calls.lock().unwrap().push(format!("delete {id}"));
        Box::pin(async move { self.deletes.lock().unwrap().pop_front().unwrap_or(Ok(())) })
    }
}

/// A scripted uploader; records the targets it was asked to send to. It reports `chunks`
/// progress steps before answering. With a gate it waits until the test lets it go.
#[derive(Default)]
pub struct FakeUploader {
    pub results: Mutex<VecDeque<Result<(), ErrorKind>>>,
    pub targets: Mutex<Vec<UploadTarget>>,
    pub chunks: Mutex<u64>,
    pub gate: Mutex<Option<oneshot::Receiver<()>>>,
}

impl ObjectUploader for FakeUploader {
    fn upload<'a>(
        &'a self,
        target: &'a UploadTarget,
        file: &'a PickedFile,
        progress: OnBytes,
    ) -> BoxFuture<'a, Result<(), ErrorKind>> {
        self.targets.lock().unwrap().push(target.clone());
        let gate = self.gate.lock().unwrap().take();
        let chunks = *self.chunks.lock().unwrap();
        Box::pin(async move {
            for step in 1..=chunks {
                progress(file.size * step / chunks, file.size);
            }
            if let Some(gate) = gate {
                let _ = gate.await;
            }
            self.results.lock().unwrap().pop_front().unwrap_or(Ok(()))
        })
    }
}

pub struct FakePicker(pub Mutex<VecDeque<Result<Option<PickedFile>, ErrorKind>>>);

impl FilePicker for FakePicker {
    fn pick(&self) -> BoxFuture<'_, Result<Option<PickedFile>, ErrorKind>> {
        Box::pin(async move { self.0.lock().unwrap().pop_front().unwrap_or(Ok(None)) })
    }
}

/// Returns scripted bytes; records the URLs it was asked for.
#[derive(Default)]
pub struct FakeFetcher {
    pub results: Mutex<VecDeque<Result<Vec<u8>, ErrorKind>>>,
    pub urls: Mutex<Vec<String>>,
    pub gate: Mutex<Option<oneshot::Receiver<()>>>,
}

impl ImageFetcher for FakeFetcher {
    fn fetch<'a>(
        &'a self,
        url: &'a SecretUrl,
        _max_bytes: u64,
    ) -> BoxFuture<'a, Result<Vec<u8>, ErrorKind>> {
        self.urls.lock().unwrap().push(url.expose().to_owned());
        let gate = self.gate.lock().unwrap().take();
        Box::pin(async move {
            if let Some(gate) = gate {
                let _ = gate.await;
            }
            self.results
                .lock()
                .unwrap()
                .pop_front()
                .unwrap_or(Err(ErrorKind::Unknown))
        })
    }
}

/// A valid PNG of the given size.
pub fn png(width: u32, height: u32) -> Vec<u8> {
    let mut bytes = Vec::new();
    image::RgbaImage::from_pixel(width, height, image::Rgba([10, 200, 30, 255]))
        .write_to(
            &mut std::io::Cursor::new(&mut bytes),
            image::ImageFormat::Png,
        )
        .unwrap();
    bytes
}

pub struct Rig {
    pub repo: Arc<FakeRepo>,
    pub uploader: Arc<FakeUploader>,
    pub service: Arc<UploadService>,
}

pub fn rig() -> Rig {
    let repo = Arc::new(FakeRepo::default());
    let uploader = Arc::new(FakeUploader::default());
    let service = Arc::new(UploadService::new(repo.clone(), uploader.clone()));
    Rig {
        repo,
        uploader,
        service,
    }
}
