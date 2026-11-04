#![allow(clippy::unwrap_used, clippy::expect_used, dead_code)]
//! Fakes and a signing helper. Keys are generated at run time; no private key exists in the repository.

use std::path::{Path, PathBuf};
use std::sync::atomic::{AtomicUsize, Ordering};
use std::sync::{Arc, Mutex};

use aedst_update::{
    Clock, FeedCandidate, FetchError, Installer, InstallerError, ManifestFetcher, PackageFetcher,
    PackageSource, PersistedState, Ports, ProgressFn, StateError, TrustedKeys, UpdateConfig,
    UpdateService, UpdateStateStore, VerifiedPackage, signing_input,
};
use ed25519_dalek::{Signer, SigningKey};
use futures::future::BoxFuture;
use semver::Version;
use sha2::{Digest, Sha256};
use url::Url;

pub const NOW: i64 = 2_000_000;
pub const PACKAGE: &[u8] = b"the genuine package bytes";

pub fn signing_key() -> SigningKey {
    SigningKey::from_bytes(&rand::random::<[u8; 32]>())
}

pub fn trusted(keys: &[(&str, &SigningKey)]) -> TrustedKeys {
    let pairs: Vec<(&str, [u8; 32])> = keys
        .iter()
        .map(|(id, k)| (*id, k.verifying_key().to_bytes()))
        .collect();
    TrustedKeys::new(&pairs).unwrap()
}

pub fn sha_hex(bytes: &[u8]) -> String {
    Sha256::digest(bytes)
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect()
}

/// A manifest document; every field can be changed before it is signed.
#[derive(Clone)]
pub struct Spec {
    pub version: String,
    pub channel: String,
    pub published_at: i64,
    pub expires_at: Option<i64>,
    pub min_supported: Option<String>,
    pub rollback: bool,
    pub sha256: String,
    pub size: u64,
}

impl Default for Spec {
    fn default() -> Self {
        Self {
            version: "1.1.0".to_owned(),
            channel: "stable".to_owned(),
            published_at: NOW - 100,
            expires_at: None,
            min_supported: None,
            rollback: false,
            sha256: sha_hex(PACKAGE),
            size: PACKAGE.len() as u64,
        }
    }
}

impl Spec {
    pub fn payload(&self) -> String {
        let mut doc = serde_json::json!({
            "version": self.version,
            "channel": self.channel,
            "releaseNotesUrl": "https://updates.example.com/notes",
            "publishedAt": self.published_at,
            "rollback": self.rollback,
            "artifacts": [{
                "platform": "windows", "arch": "x86_64",
                "url": "https://updates.example.com/aedst-1.1.0.nupkg",
                "sha256": self.sha256, "size": self.size,
            }],
        });
        if let Some(expires) = self.expires_at {
            doc["expiresAt"] = expires.into();
        }
        if let Some(min) = &self.min_supported {
            doc["minSupportedVersion"] = min.clone().into();
        }
        doc.to_string()
    }

    pub fn signed_by(&self, signers: &[(&str, &SigningKey)]) -> Vec<u8> {
        envelope(&self.payload(), signers)
    }
}

pub fn envelope(payload: &str, signers: &[(&str, &SigningKey)]) -> Vec<u8> {
    let message = signing_input(payload);
    let signatures: Vec<_> = signers
        .iter()
        .map(|(id, key)| {
            let signature: String = key
                .sign(&message)
                .to_bytes()
                .iter()
                .map(|b| format!("{b:02x}"))
                .collect();
            serde_json::json!({ "keyId": id, "signature": signature })
        })
        .collect();
    serde_json::json!({ "payload": payload, "signatures": signatures })
        .to_string()
        .into_bytes()
}

/// A scratch directory removed on drop.
pub struct TempDir(pub PathBuf);

impl TempDir {
    pub fn new() -> Self {
        let dir = std::env::temp_dir().join(format!("aedst-update-test-{}", uuid::Uuid::new_v4()));
        std::fs::create_dir_all(&dir).unwrap();
        Self(dir)
    }

    pub fn file(&self, name: &str) -> PathBuf {
        self.0.join(name)
    }
}

impl Drop for TempDir {
    fn drop(&mut self) {
        let _ = std::fs::remove_dir_all(&self.0);
    }
}

#[derive(Default)]
pub struct MemoryStore(pub Mutex<PersistedState>);

impl UpdateStateStore for MemoryStore {
    fn load(&self) -> PersistedState {
        self.0.lock().unwrap().clone()
    }

    fn save(&self, state: &PersistedState) -> Result<(), StateError> {
        *self.0.lock().unwrap() = state.clone();
        Ok(())
    }
}

pub struct FakeManifests {
    pub body: Mutex<Vec<u8>>,
    pub calls: AtomicUsize,
}

impl ManifestFetcher for FakeManifests {
    fn fetch<'a>(
        &'a self,
        _url: &'a Url,
        _max: usize,
    ) -> BoxFuture<'a, Result<Vec<u8>, FetchError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let body = self.body.lock().unwrap().clone();
        Box::pin(async move { Ok(body) })
    }
}

/// Writes `bytes` as the package; tests change `bytes` to simulate a tampered download.
pub struct FakePackages {
    pub bytes: Mutex<Vec<u8>>,
    pub calls: AtomicUsize,
}

impl PackageFetcher for FakePackages {
    fn fetch_to_file<'a>(
        &'a self,
        _url: &'a Url,
        dest: &'a Path,
        _max: u64,
        progress: ProgressFn,
    ) -> BoxFuture<'a, Result<(), FetchError>> {
        self.calls.fetch_add(1, Ordering::SeqCst);
        let bytes = self.bytes.lock().unwrap().clone();
        Box::pin(async move {
            std::fs::create_dir_all(dest.parent().unwrap()).unwrap();
            std::fs::write(dest, bytes).map_err(|e| FetchError(e.to_string()))?;
            progress(100);
            Ok(())
        })
    }
}

/// An installer whose feed entry and package file are chosen by the test.
pub struct FakeInstaller {
    pub self_update: bool,
    pub source: PackageSource,
    pub candidate: Mutex<Option<FeedCandidate>>,
    /// What `download` writes and reports; `None` = reports no path.
    pub feed_package: Mutex<Option<(PathBuf, Vec<u8>)>>,
    pub downloads: AtomicUsize,
    pub applied: Mutex<Vec<(Version, bool)>>,
}

impl FakeInstaller {
    pub fn feed(candidate: Option<FeedCandidate>, package: Option<(PathBuf, Vec<u8>)>) -> Self {
        Self {
            self_update: true,
            source: PackageSource::InstallerFeed,
            candidate: Mutex::new(candidate),
            feed_package: Mutex::new(package),
            downloads: AtomicUsize::new(0),
            applied: Mutex::new(Vec::new()),
        }
    }

    pub fn manifest_mode() -> Self {
        Self {
            source: PackageSource::Manifest,
            ..Self::feed(None, None)
        }
    }

    pub fn feed_for_manifest_mode(_dir: &TempDir) -> Self {
        Self::manifest_mode()
    }
}

pub type FeedCandidateEdit = Box<dyn Fn(&mut FeedCandidate)>;

impl Installer for FakeInstaller {
    fn can_self_update(&self) -> bool {
        self.self_update
    }

    fn package_source(&self) -> PackageSource {
        self.source
    }

    fn check_feed<'a>(
        &'a self,
        _channel: &'a str,
        _allow_downgrade: bool,
    ) -> BoxFuture<'a, Result<Option<FeedCandidate>, InstallerError>> {
        let candidate = self.candidate.lock().unwrap().clone();
        Box::pin(async move { Ok(candidate) })
    }

    fn download<'a>(
        &'a self,
        _candidate: &'a FeedCandidate,
        _progress: ProgressFn,
    ) -> BoxFuture<'a, Result<Option<PathBuf>, InstallerError>> {
        self.downloads.fetch_add(1, Ordering::SeqCst);
        let package = self.feed_package.lock().unwrap().clone();
        Box::pin(async move {
            Ok(package.map(|(path, bytes)| {
                std::fs::create_dir_all(path.parent().unwrap()).unwrap();
                std::fs::write(&path, bytes).unwrap();
                path
            }))
        })
    }

    fn apply<'a>(
        &'a self,
        package: &'a VerifiedPackage,
        restart: bool,
    ) -> BoxFuture<'a, Result<(), InstallerError>> {
        self.applied
            .lock()
            .unwrap()
            .push((package.version.clone(), restart));
        Box::pin(async { Ok(()) })
    }
}

pub fn feed_candidate(version: &str, bytes: &[u8]) -> FeedCandidate {
    FeedCandidate {
        version: version.to_owned(),
        sha256: sha_hex(bytes).to_uppercase(),
        size: bytes.len() as u64,
        file_name: format!("Aedst-{version}-full.nupkg"),
    }
}

pub struct Harness {
    pub service: Arc<UpdateService>,
    pub manifests: Arc<FakeManifests>,
    pub packages: Arc<FakePackages>,
    pub installer: Arc<FakeInstaller>,
    pub store: Arc<MemoryStore>,
    pub dir: TempDir,
}

pub fn config(dir: &TempDir) -> UpdateConfig {
    UpdateConfig {
        manifest_url: "https://updates.example.com/stable.json".to_owned(),
        installed_version: Version::new(1, 0, 0),
        channel: "stable".to_owned(),
        platform: "windows".to_owned(),
        arch: "x86_64".to_owned(),
        allow_downgrade: false,
        max_manifest_bytes: 256 * 1024,
        staging_dir: dir.file("staging"),
    }
}

pub fn harness(
    keys: TrustedKeys,
    manifest: Vec<u8>,
    installer: impl FnOnce(&TempDir) -> FakeInstaller,
) -> Harness {
    harness_with(keys, manifest, installer, |_| {})
}

pub fn harness_with(
    keys: TrustedKeys,
    manifest: Vec<u8>,
    installer: impl FnOnce(&TempDir) -> FakeInstaller,
    tweak: impl FnOnce(&mut UpdateConfig),
) -> Harness {
    let dir = TempDir::new();
    let manifests = Arc::new(FakeManifests {
        body: Mutex::new(manifest),
        calls: AtomicUsize::new(0),
    });
    let packages = Arc::new(FakePackages {
        bytes: Mutex::new(PACKAGE.to_vec()),
        calls: AtomicUsize::new(0),
    });
    let installer = Arc::new(installer(&dir));
    let store = Arc::new(MemoryStore::default());
    let clock: Clock = Arc::new(|| NOW);
    let mut cfg = config(&dir);
    tweak(&mut cfg);
    let service = Arc::new(UpdateService::new(
        cfg,
        keys,
        Ports {
            manifests: manifests.clone(),
            packages: packages.clone(),
            installer: installer.clone(),
            store: store.clone(),
            clock,
        },
    ));
    Harness {
        service,
        manifests,
        packages,
        installer,
        store,
        dir,
    }
}
