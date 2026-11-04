#![allow(clippy::unwrap_used, clippy::expect_used)]
//! `HttpFetcher` against a throw-away server on 127.0.0.1 (plain http is allowed for loopback in debug builds).

mod support;

use std::sync::Arc;

use aedst_update::{HttpFetcher, ManifestFetcher, PackageFetcher};
use tokio::io::{AsyncReadExt, AsyncWriteExt};
use tokio::net::TcpListener;
use url::Url;

/// Answers every connection with `response(path)`.
async fn serve(response: fn(&str) -> Vec<u8>) -> u16 {
    let listener = TcpListener::bind("127.0.0.1:0").await.unwrap();
    let port = listener.local_addr().unwrap().port();
    tokio::spawn(async move {
        loop {
            let Ok((mut socket, _)) = listener.accept().await else {
                return;
            };
            tokio::spawn(async move {
                let mut buffer = vec![0_u8; 4096];
                let read = socket.read(&mut buffer).await.unwrap_or(0);
                let request = String::from_utf8_lossy(&buffer[..read]).into_owned();
                let path = request.split_whitespace().nth(1).unwrap_or("/").to_owned();
                let _ = socket.write_all(&response(&path)).await;
                let _ = socket.shutdown().await;
            });
        }
    });
    port
}

fn ok(body: &[u8]) -> Vec<u8> {
    let mut out = format!(
        "HTTP/1.1 200 OK\r\nContent-Length: {}\r\nConnection: close\r\n\r\n",
        body.len()
    )
    .into_bytes();
    out.extend_from_slice(body);
    out
}

fn routes(path: &str) -> Vec<u8> {
    match path {
        "/manifest" => ok(b"0123456789"),
        "/missing" => b"HTTP/1.1 404 Not Found\r\nContent-Length: 0\r\nConnection: close\r\n\r\n".to_vec(),
        "/away" => b"HTTP/1.1 302 Found\r\nLocation: http://localhost:9/x\r\nContent-Length: 0\r\nConnection: close\r\n\r\n"
            .to_vec(),
        _ => ok(b"x"),
    }
}

#[tokio::test]
async fn manifests_are_fetched_capped_and_errors_are_reported() {
    let port = serve(routes).await;
    let fetcher = HttpFetcher::new("desktop/test").unwrap();
    let url = |p: &str| Url::parse(&format!("http://127.0.0.1:{port}{p}")).unwrap();

    assert_eq!(
        fetcher.fetch(&url("/manifest"), 100).await.unwrap(),
        b"0123456789"
    );
    assert!(
        fetcher.fetch(&url("/manifest"), 5).await.is_err(),
        "over the cap"
    );
    assert!(
        fetcher.fetch(&url("/missing"), 100).await.is_err(),
        "HTTP 404"
    );
    assert!(
        fetcher.fetch(&url("/away"), 100).await.is_err(),
        "a redirect to another host is not followed"
    );
}

#[tokio::test]
async fn packages_stream_to_a_file_within_the_cap_and_failures_leave_nothing() {
    let port = serve(routes).await;
    let fetcher = HttpFetcher::new("desktop/test").unwrap();
    let dir = support::TempDir::new();
    let url = Url::parse(&format!("http://127.0.0.1:{port}/manifest")).unwrap();
    let dest = dir.file("pkg/file.bin");
    let seen = Arc::new(std::sync::Mutex::new(Vec::new()));
    let sink = Arc::clone(&seen);
    let progress: aedst_update::ProgressFn = Arc::new(move |p| sink.lock().unwrap().push(p));

    fetcher
        .fetch_to_file(&url, &dest, 100, progress.clone())
        .await
        .unwrap();
    assert_eq!(std::fs::read(&dest).unwrap(), b"0123456789");
    assert_eq!(seen.lock().unwrap().last(), Some(&100));

    let small = dir.file("pkg/small.bin");
    assert!(
        fetcher
            .fetch_to_file(&url, &small, 5, progress)
            .await
            .is_err()
    );
    assert!(!small.exists());
}
