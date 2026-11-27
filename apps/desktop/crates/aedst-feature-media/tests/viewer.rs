//! The viewer view model and the decoder.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use std::sync::Arc;

use aedst_common::ErrorKind;
use aedst_feature_media::{
    domain::{MediaKind, MediaStatus, VariantKind},
    presentation::{
        DecodeError, MAX_DISPLAY_EDGE, MAX_PIXELS, ViewerController, ViewerPhase, decode,
    },
};
use support::{FakeFetcher, image, media, png, with_variant};
use tokio::sync::oneshot;

fn viewer(fetcher: &Arc<FakeFetcher>) -> Arc<ViewerController> {
    ViewerController::new(fetcher.clone())
}

#[tokio::test]
async fn a_ready_image_is_downloaded_and_decoded() {
    let fetcher = Arc::new(FakeFetcher::default());
    fetcher.results.lock().unwrap().push_back(Ok(png(7, 3)));
    let v = viewer(&fetcher);

    v.open(&image("a")).await;

    let view = v.subscribe().borrow().clone();
    assert_eq!(
        (view.phase, view.title.as_str()),
        (ViewerPhase::Ready, "a.bin")
    );
    let decoded = view.image.unwrap();
    assert_eq!(
        (decoded.width, decoded.height, decoded.rgba.len()),
        (7, 3, 7 * 3 * 4)
    );
    assert_eq!(&decoded.rgba[..4], &[10, 200, 30, 255]);
    // The original is what an image preview downloads.
    assert_eq!(
        fetcher.urls.lock().unwrap().as_slice(),
        ["https://storage.example/a?sig=SECRET"]
    );
}

#[tokio::test]
async fn a_video_shows_the_placeholder_and_downloads_nothing() {
    let fetcher = Arc::new(FakeFetcher::default());
    let v = viewer(&fetcher);

    v.open(&media("v", MediaKind::Video, MediaStatus::Ready))
        .await;

    let view = v.subscribe().borrow().clone();
    assert_eq!(view.phase, ViewerPhase::VideoUnavailable);
    assert!(view.image.is_none());
    assert!(fetcher.urls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn files_that_are_not_ready_or_have_no_preview_download_nothing() {
    let fetcher = Arc::new(FakeFetcher::default());
    let v = viewer(&fetcher);
    let cases = [
        (
            media("a", MediaKind::Image, MediaStatus::Processing),
            ViewerPhase::NotReady,
        ),
        (
            media("b", MediaKind::Image, MediaStatus::PendingUpload),
            ViewerPhase::NotReady,
        ),
        (
            media("c", MediaKind::Image, MediaStatus::Failed),
            ViewerPhase::NotReady,
        ),
        (
            media("d", MediaKind::Audio, MediaStatus::Ready),
            ViewerPhase::NoPreview,
        ),
        (
            media("e", MediaKind::Document, MediaStatus::Ready),
            ViewerPhase::NoPreview,
        ),
        (
            media("f", MediaKind::Unknown, MediaStatus::Ready),
            ViewerPhase::NoPreview,
        ),
    ];
    for (m, expected) in cases {
        v.open(&m).await;
        assert_eq!(v.subscribe().borrow().phase, expected, "{}", m.id);
    }
    // A ready image without any URL has nothing to show either.
    let mut no_url = image("g");
    no_url.url = aedst_feature_media::domain::SecretUrl::new("");
    v.open(&no_url).await;
    assert_eq!(v.subscribe().borrow().phase, ViewerPhase::NotReady);
    assert!(fetcher.urls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_failed_download_shows_its_kind_and_cancelled_closes_quietly() {
    let fetcher = Arc::new(FakeFetcher::default());
    fetcher
        .results
        .lock()
        .unwrap()
        .extend([Err(ErrorKind::Offline), Err(ErrorKind::Cancelled)]);
    let v = viewer(&fetcher);

    v.open(&image("a")).await;
    assert_eq!(
        v.subscribe().borrow().phase,
        ViewerPhase::Failed(ErrorKind::Offline)
    );

    v.open(&image("a")).await;
    assert_eq!(v.subscribe().borrow().phase, ViewerPhase::Closed);
}

#[tokio::test]
async fn bytes_that_are_not_a_picture_are_undecodable() {
    let fetcher = Arc::new(FakeFetcher::default());
    fetcher
        .results
        .lock()
        .unwrap()
        .push_back(Ok(b"<html>not an image</html>".to_vec()));
    let v = viewer(&fetcher);

    v.open(&image("a")).await;

    let view = v.subscribe().borrow().clone();
    assert_eq!(view.phase, ViewerPhase::Undecodable);
    assert!(view.image.is_none());
}

#[tokio::test]
async fn a_declared_size_over_the_cap_is_refused_before_any_download() {
    let fetcher = Arc::new(FakeFetcher::default());
    let v = viewer(&fetcher);
    let mut huge = image("a");
    huge.width = 20_000;
    huge.height = 20_000;

    v.open(&huge).await;

    assert_eq!(v.subscribe().borrow().phase, ViewerPhase::TooLarge);
    assert!(fetcher.urls.lock().unwrap().is_empty());
}

#[tokio::test]
async fn a_video_poster_is_never_chosen_for_an_image_and_unknown_variants_are_ignored() {
    // An image previews its original even when renditions exist (presets are cropped boxes).
    let fetcher = Arc::new(FakeFetcher::default());
    fetcher.results.lock().unwrap().push_back(Ok(png(2, 2)));
    let v = viewer(&fetcher);
    let m = with_variant(
        with_variant(image("a"), VariantKind::Card400, 400, 300),
        VariantKind::Unknown,
        9,
        9,
    );

    v.open(&m).await;

    assert_eq!(v.subscribe().borrow().phase, ViewerPhase::Ready);
    assert_eq!(
        fetcher.urls.lock().unwrap().as_slice(),
        ["https://storage.example/a?sig=SECRET"]
    );
}

#[tokio::test]
async fn closing_or_opening_another_file_drops_the_older_download() {
    let fetcher = Arc::new(FakeFetcher::default());
    let (open, gate) = oneshot::channel();
    *fetcher.gate.lock().unwrap() = Some(gate);
    fetcher
        .results
        .lock()
        .unwrap()
        .extend([Ok(png(2, 2)), Ok(png(5, 5))]);
    let v = viewer(&fetcher);

    let slow = tokio::spawn({
        let (v, m) = (Arc::clone(&v), image("slow"));
        async move { v.open(&m).await }
    });
    tokio::task::yield_now().await;
    assert_eq!(v.subscribe().borrow().phase, ViewerPhase::Loading);

    v.close();
    let _ = open.send(());
    slow.await.unwrap();
    assert_eq!(
        v.subscribe().borrow().phase,
        ViewerPhase::Closed,
        "the late result is dropped"
    );
}

#[test]
fn decoding_respects_the_pixel_cap_and_rejects_garbage() {
    assert!(decode(&png(4, 4)).is_ok());
    assert_eq!(decode(b"nope").unwrap_err(), DecodeError::Undecodable);
    assert_eq!(decode(&[]).unwrap_err(), DecodeError::Undecodable);

    // A BMP header declaring 10 000 x 10 000 pixels (100 million): refused from the header alone.
    let side: i32 = 10_000;
    assert!(u64::try_from(side).unwrap().pow(2) > MAX_PIXELS);
    let mut bmp = Vec::new();
    bmp.extend_from_slice(b"BM");
    bmp.extend_from_slice(&54_u32.to_le_bytes());
    bmp.extend_from_slice(&[0; 4]);
    bmp.extend_from_slice(&54_u32.to_le_bytes());
    bmp.extend_from_slice(&40_u32.to_le_bytes());
    bmp.extend_from_slice(&side.to_le_bytes());
    bmp.extend_from_slice(&side.to_le_bytes());
    bmp.extend_from_slice(&1_u16.to_le_bytes());
    bmp.extend_from_slice(&24_u16.to_le_bytes());
    bmp.extend_from_slice(&[0; 24]);
    assert_eq!(decode(&bmp).unwrap_err(), DecodeError::TooLarge);
}

#[test]
fn a_large_picture_is_downscaled_to_the_display_cap_keeping_its_aspect() {
    let wide = decode(&png(MAX_DISPLAY_EDGE * 2, 10)).unwrap();
    assert_eq!((wide.width, wide.height), (MAX_DISPLAY_EDGE, 5));
    assert_eq!(wide.rgba.len(), (wide.width * wide.height * 4) as usize);

    let small = decode(&png(7, 3)).unwrap();
    assert_eq!(
        (small.width, small.height),
        (7, 3),
        "small pictures keep their size"
    );
}
