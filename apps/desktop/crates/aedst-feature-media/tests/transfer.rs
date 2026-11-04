//! The presigned-URL transfers against a local HTTP server (wiremock): the exact bytes, the
//! headers, progress, status mapping, no redirects for uploads, the URL policy, and that the
//! signature never shows up in a result.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

use std::{
    io::Write,
    sync::{Arc, Mutex},
};

use aedst_common::ErrorKind;
use aedst_feature_media::{
    data::{ReqwestImageFetcher, ReqwestUploader},
    domain::{ImageFetcher, ObjectUploader, PickedFile, SecretUrl, UploadTarget},
};
use wiremock::{
    Mock, MockServer, ResponseTemplate,
    matchers::{header, header_exists, method, path},
};

fn temp_file(bytes: &[u8]) -> (tempdir::Guard, PickedFile) {
    let guard = tempdir::Guard::new();
    let path = guard.0.join("upload.bin");
    std::fs::File::create(&path)
        .unwrap()
        .write_all(bytes)
        .unwrap();
    let picked = PickedFile {
        path,
        file_name: "upload.bin".into(),
        content_type: "image/png".into(),
        size: bytes.len() as u64,
    };
    (guard, picked)
}

/// A scratch directory under the target dir, removed on drop (files only, no recursive delete).
mod tempdir {
    use std::path::PathBuf;

    pub struct Guard(pub PathBuf);

    impl Guard {
        pub fn new() -> Self {
            let dir = PathBuf::from(env!("CARGO_TARGET_TMPDIR"))
                .join(format!("transfer-{}", uuid::Uuid::new_v4()));
            std::fs::create_dir_all(&dir).unwrap();
            Self(dir)
        }
    }

    impl Drop for Guard {
        fn drop(&mut self) {
            if let Ok(entries) = std::fs::read_dir(&self.0) {
                for entry in entries.flatten() {
                    let _ = std::fs::remove_file(entry.path());
                }
            }
            let _ = std::fs::remove_dir(&self.0);
        }
    }
}

fn target(server: &MockServer, route: &str, headers: Vec<(String, String)>) -> UploadTarget {
    UploadTarget {
        url: SecretUrl::new(format!("{}{route}?X-Amz-Signature=SECRET", server.uri())),
        method: "PUT".into(),
        headers,
        expires_at: None,
    }
}

fn no_progress() -> Arc<dyn Fn(u64, u64) + Send + Sync> {
    Arc::new(|_, _| {})
}

#[tokio::test]
async fn the_file_is_put_with_the_returned_headers_and_progress_reaches_the_total() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .and(path("/obj"))
        .and(header("x-amz-meta-owner", "me"))
        .and(header("content-type", "image/png"))
        .respond_with(ResponseTemplate::new(200))
        .expect(1)
        .mount(&server)
        .await;
    let bytes: Vec<u8> = (0..600_000_u32).map(|i| (i % 251) as u8).collect(); // spans three chunks
    let (_guard, picked) = temp_file(&bytes);
    let seen = Arc::new(Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    let progress: Arc<dyn Fn(u64, u64) + Send + Sync> =
        Arc::new(move |sent, total| sink.lock().unwrap().push((sent, total)));
    let headers = vec![
        ("x-amz-meta-owner".to_owned(), "me".to_owned()),
        ("Authorization".to_owned(), "Bearer LEAK".to_owned()), // must not be forwarded
    ];

    let result = ReqwestUploader::new()
        .unwrap()
        .upload(&target(&server, "/obj", headers), &picked, progress)
        .await;

    assert_eq!(result, Ok(()));
    let requests = server.received_requests().await.unwrap();
    assert_eq!(requests[0].body, bytes, "the exact bytes arrive");
    assert_eq!(
        requests[0]
            .headers
            .get("content-length")
            .unwrap()
            .to_str()
            .unwrap(),
        "600000"
    );
    assert!(
        requests[0].headers.get("authorization").is_none(),
        "credentials are not forwarded"
    );
    let seen = seen.lock().unwrap().clone();
    assert_eq!(seen.last(), Some(&(600_000, 600_000)));
    assert!(
        seen.windows(2).all(|w| w[0].0 < w[1].0),
        "progress only grows"
    );
}

#[tokio::test]
async fn statuses_map_to_kinds_and_the_url_never_appears_in_the_result() {
    let server = MockServer::start().await;
    for (route, status) in [
        ("/expired", 403),
        ("/busy", 503),
        ("/slow", 429),
        ("/bad", 400),
    ] {
        Mock::given(path(route))
            .respond_with(ResponseTemplate::new(status))
            .mount(&server)
            .await;
    }
    let (_guard, picked) = temp_file(b"hello");
    let uploader = ReqwestUploader::new().unwrap();
    for (route, expected) in [
        ("/expired", ErrorKind::Forbidden),
        ("/busy", ErrorKind::Unavailable),
        ("/slow", ErrorKind::RateLimited),
        ("/bad", ErrorKind::InvalidInput),
    ] {
        let result = uploader
            .upload(&target(&server, route, vec![]), &picked, no_progress())
            .await;
        assert_eq!(result, Err(expected), "{route}");
        assert!(!format!("{result:?}").contains("SECRET"));
    }
}

#[tokio::test]
async fn an_upload_never_follows_a_redirect() {
    let server = MockServer::start().await;
    Mock::given(path("/start"))
        .respond_with(ResponseTemplate::new(307).insert_header("location", "/elsewhere"))
        .mount(&server)
        .await;
    Mock::given(path("/elsewhere"))
        .respond_with(ResponseTemplate::new(200))
        .expect(0)
        .mount(&server)
        .await;
    let (_guard, picked) = temp_file(b"secret bytes");

    let result = ReqwestUploader::new()
        .unwrap()
        .upload(&target(&server, "/start", vec![]), &picked, no_progress())
        .await;

    assert_eq!(result, Err(ErrorKind::Unknown));
}

#[tokio::test]
async fn an_insecure_or_malformed_url_is_refused_before_any_request() {
    let (_guard, picked) = temp_file(b"x");
    let uploader = ReqwestUploader::new().unwrap();
    for url in [
        "http://storage.example.com/o?sig=SECRET",
        "ftp://x/o",
        "nonsense",
        "",
    ] {
        let target = UploadTarget {
            url: SecretUrl::new(url),
            method: "PUT".into(),
            headers: vec![],
            expires_at: None,
        };
        let result = uploader.upload(&target, &picked, no_progress()).await;
        assert_eq!(result, Err(ErrorKind::Unknown), "{url}");
    }
    // An unknown verb is refused as well.
    let server = MockServer::start().await;
    let mut odd = target(&server, "/o", vec![]);
    odd.method = "DELETE".into();
    assert_eq!(
        uploader.upload(&odd, &picked, no_progress()).await,
        Err(ErrorKind::Unknown)
    );
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn a_file_that_changed_since_it_was_picked_is_not_sent() {
    let server = MockServer::start().await;
    Mock::given(method("PUT"))
        .respond_with(ResponseTemplate::new(200))
        .mount(&server)
        .await;
    let (_guard, mut picked) = temp_file(b"12345");
    picked.size = 99; // the file on disk is 5 bytes
    let uploader = ReqwestUploader::new().unwrap();
    assert_eq!(
        uploader
            .upload(&target(&server, "/o", vec![]), &picked, no_progress())
            .await,
        Err(ErrorKind::Storage)
    );
    picked.path = picked.path.with_file_name("missing.bin");
    assert_eq!(
        uploader
            .upload(&target(&server, "/o", vec![]), &picked, no_progress())
            .await,
        Err(ErrorKind::Storage)
    );
    assert!(server.received_requests().await.unwrap().is_empty());
}

#[tokio::test]
async fn an_unreachable_server_is_offline() {
    let (_guard, picked) = temp_file(b"x");
    // Bind to a free port and close it again: nothing listens there any more.
    let gone = {
        let listener = std::net::TcpListener::bind("127.0.0.1:0").unwrap();
        format!("http://{}", listener.local_addr().unwrap())
    };
    let target = UploadTarget {
        url: SecretUrl::new(format!("{gone}/o?sig=SECRET")),
        method: "PUT".into(),
        headers: vec![],
        expires_at: None,
    };
    let result = ReqwestUploader::new()
        .unwrap()
        .upload(&target, &picked, no_progress())
        .await;
    assert_eq!(result, Err(ErrorKind::Offline));
}

#[tokio::test]
async fn an_image_is_downloaded_with_an_accept_header() {
    let server = MockServer::start().await;
    Mock::given(method("GET"))
        .and(path("/img"))
        .and(header_exists("accept"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![1_u8, 2, 3]))
        .mount(&server)
        .await;
    let url = SecretUrl::new(format!("{}/img?sig=SECRET", server.uri()));

    let bytes = ReqwestImageFetcher::new().unwrap().fetch(&url, 1024).await;

    assert_eq!(bytes, Ok(vec![1, 2, 3]));
    let requests = server.received_requests().await.unwrap();
    let accept = requests[0]
        .headers
        .get("accept")
        .unwrap()
        .to_str()
        .unwrap()
        .to_owned();
    assert!(
        accept.contains("image/webp") && !accept.contains("avif"),
        "{accept}"
    );
}

#[tokio::test]
async fn a_download_over_the_cap_fails_and_statuses_map_to_kinds() {
    let server = MockServer::start().await;
    Mock::given(path("/big"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![0_u8; 5000]))
        .mount(&server)
        .await;
    Mock::given(path("/gone"))
        .respond_with(ResponseTemplate::new(404))
        .mount(&server)
        .await;
    Mock::given(path("/expired"))
        .respond_with(ResponseTemplate::new(403))
        .mount(&server)
        .await;
    let fetcher = ReqwestImageFetcher::new().unwrap();
    let url = |route: &str| SecretUrl::new(format!("{}{route}?sig=SECRET", server.uri()));

    assert_eq!(
        fetcher.fetch(&url("/big"), 4999).await,
        Err(ErrorKind::InvalidInput)
    );
    assert_eq!(
        fetcher.fetch(&url("/big"), 5000).await.map(|b| b.len()),
        Ok(5000)
    );
    assert_eq!(
        fetcher.fetch(&url("/gone"), 10).await,
        Err(ErrorKind::NotFound)
    );
    assert_eq!(
        fetcher.fetch(&url("/expired"), 10).await,
        Err(ErrorKind::Forbidden)
    );
    assert_eq!(
        fetcher
            .fetch(&SecretUrl::new("http://cdn.example.com/x?sig=SECRET"), 10)
            .await,
        Err(ErrorKind::Unknown),
        "plain http outside loopback is refused"
    );
}

#[tokio::test]
async fn a_download_follows_a_same_scheme_redirect_but_not_a_loop() {
    let server = MockServer::start().await;
    Mock::given(path("/a"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", "/b"))
        .mount(&server)
        .await;
    Mock::given(path("/b"))
        .respond_with(ResponseTemplate::new(200).set_body_bytes(vec![9_u8]))
        .mount(&server)
        .await;
    Mock::given(path("/loop"))
        .respond_with(ResponseTemplate::new(302).insert_header("location", "/loop"))
        .mount(&server)
        .await;
    let fetcher = ReqwestImageFetcher::new().unwrap();
    let url = |route: &str| SecretUrl::new(format!("{}{route}", server.uri()));

    assert_eq!(fetcher.fetch(&url("/a"), 10).await, Ok(vec![9]));
    assert_eq!(
        fetcher.fetch(&url("/loop"), 10).await,
        Err(ErrorKind::Unknown)
    );
}
