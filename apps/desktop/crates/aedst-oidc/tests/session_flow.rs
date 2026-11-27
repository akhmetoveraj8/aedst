//! The whole flow against a fake identity provider: sign-in, refresh, revocation, failure modes.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

mod support;

use std::sync::{
    Arc,
    atomic::{AtomicBool, Ordering},
};

use aedst_oidc::{
    OidcError, OidcSession, Revocation,
    store::{MemoryStore, RefreshTokenStore, StoredSession},
};
use support::{Idp, TokenBehavior};
use tokio_util::sync::CancellationToken;
use zeroize::Zeroizing;

fn stored(refresh: &str) -> StoredSession {
    StoredSession {
        refresh_token: Zeroizing::new(refresh.into()),
        subject: "user-1".into(),
    }
}

#[tokio::test]
async fn sign_in_runs_pkce_stores_the_refresh_token_and_hands_out_the_access_token() {
    let idp = Idp::start(TokenBehavior::Normal).await;
    let store = Arc::new(MemoryStore::default());
    let session = OidcSession::new(idp.config.clone(), store.clone()).unwrap();
    let browser = idp.browser();

    let subject = session
        .sign_in(&browser, &CancellationToken::new())
        .await
        .unwrap();

    assert_eq!(subject, "user-1");
    assert_eq!(session.access_token().await.unwrap().expose(), "AT1");
    assert_eq!(store.load().unwrap().unwrap().refresh_token.as_str(), "RT1");
    let url = browser.seen.lock().unwrap().clone().unwrap();
    let query: std::collections::HashMap<_, _> = url.query_pairs().into_owned().collect();
    assert_eq!(query["code_challenge_method"], "S256");
    assert!(query["scope"].contains("openid") && query["scope"].contains("offline_access"));
    assert!(query["scope"].contains("urn:zitadel:iam:org:project:id:42:aud"));
    assert!(
        query["redirect_uri"].starts_with("http://127.0.0.1:")
            || query["redirect_uri"].starts_with("http://[::1]:")
    );
}

#[tokio::test]
async fn a_wrong_nonce_in_the_id_token_fails_the_sign_in_and_stores_nothing() {
    let idp = Idp::start(TokenBehavior::WrongNonce).await;
    let store = Arc::new(MemoryStore::default());
    let session = OidcSession::new(idp.config.clone(), store.clone()).unwrap();

    let result = session
        .sign_in(&idp.browser(), &CancellationToken::new())
        .await;

    assert!(matches!(result, Err(OidcError::Security(_))), "{result:?}");
    assert!(store.load().unwrap().is_none());
}

#[tokio::test]
async fn without_a_keychain_sign_in_fails_and_keeps_no_session() {
    let idp = Idp::start(TokenBehavior::Normal).await;
    let session =
        OidcSession::new(idp.config.clone(), Arc::new(MemoryStore::unavailable())).unwrap();

    let result = session
        .sign_in(&idp.browser(), &CancellationToken::new())
        .await;

    assert!(matches!(result, Err(OidcError::Keychain(_))), "{result:?}");
    assert!(
        session.subject().is_none(),
        "no session without a secure store"
    );
}

#[tokio::test]
async fn restore_refreshes_and_concurrent_forced_refreshes_share_one_request() {
    let idp = Idp::start(TokenBehavior::Normal).await;
    let store = Arc::new(MemoryStore::default());
    store.save(&stored("RT0")).unwrap();
    let session = OidcSession::new(idp.config.clone(), store.clone()).unwrap();

    assert_eq!(session.restore().await.unwrap(), Some("user-1".into()));
    assert_eq!(session.access_token().await.unwrap().expose(), "AT-R1");
    assert_eq!(
        store.load().unwrap().unwrap().refresh_token.as_str(),
        "RT-R1",
        "rotated token persisted"
    );

    let calls: Vec<_> = (0..6)
        .map(|_| {
            let s = session.clone();
            tokio::spawn(async move { s.refresh_after_rejection().await })
        })
        .collect();
    for call in calls {
        assert_eq!(call.await.unwrap().unwrap().expose(), "AT-R2");
    }
    assert_eq!(
        idp.refresh_calls.load(Ordering::SeqCst),
        2,
        "restore + one shared refresh"
    );
}

/// Reads work; writes fail while `fail_saves` is set (a keychain that is locked mid-session).
#[derive(Default)]
struct SaveFailingStore {
    inner: MemoryStore,
    fail_saves: AtomicBool,
}

impl RefreshTokenStore for SaveFailingStore {
    fn load(&self) -> Result<Option<StoredSession>, OidcError> {
        self.inner.load()
    }

    fn save(&self, session: &StoredSession) -> Result<(), OidcError> {
        if self.fail_saves.load(Ordering::SeqCst) {
            return Err(OidcError::Keychain("locked".into()));
        }
        self.inner.save(session)
    }

    fn clear(&self) -> Result<(), OidcError> {
        self.inner.clear()
    }
}

#[tokio::test]
async fn a_failed_keychain_write_keeps_the_rotated_refresh_token_in_memory() {
    let idp = Idp::start(TokenBehavior::Normal).await;
    let store = Arc::new(SaveFailingStore::default());
    store.inner.save(&stored("RT0")).unwrap();
    store.fail_saves.store(true, Ordering::SeqCst);
    let session = OidcSession::new(idp.config.clone(), store.clone()).unwrap();

    assert_eq!(session.restore().await.unwrap(), Some("user-1".into()));
    assert_eq!(session.access_token().await.unwrap().expose(), "AT-R1");

    // The next refresh must send the rotated token, never the one the provider already replaced.
    assert_eq!(
        session.refresh_after_rejection().await.unwrap().expose(),
        "AT-R2"
    );
    assert_eq!(
        idp.last_refresh_token.lock().unwrap().as_deref(),
        Some("RT-R1")
    );

    // Once the keychain works again, the newest token is stored.
    store.fail_saves.store(false, Ordering::SeqCst);
    session.refresh_after_rejection().await.unwrap();
    assert_eq!(
        store.load().unwrap().unwrap().refresh_token.as_str(),
        "RT-R3"
    );
}

#[tokio::test]
async fn invalid_grant_ends_the_session_and_clears_the_keychain() {
    let idp = Idp::start(TokenBehavior::RefreshInvalidGrant).await;
    let store = Arc::new(MemoryStore::default());
    store.save(&stored("RT0")).unwrap();
    let session = OidcSession::new(idp.config.clone(), store.clone()).unwrap();

    let result = session.restore().await;

    assert!(matches!(result, Err(OidcError::Rejected(_))), "{result:?}");
    assert!(store.load().unwrap().is_none());
    assert!(session.subject().is_none());
}

#[tokio::test]
async fn an_unreachable_provider_keeps_the_stored_session() {
    let mut idp = Idp::start(TokenBehavior::Normal).await;
    idp.config.issuer = "http://127.0.0.1:1".into();
    let store = Arc::new(MemoryStore::default());
    store.save(&stored("RT0")).unwrap();
    let session = OidcSession::new(idp.config.clone(), store.clone()).unwrap();

    let result = session.restore().await;

    assert!(
        matches!(result, Err(OidcError::Unavailable(_))),
        "{result:?}"
    );
    assert!(store.load().unwrap().is_some(), "offline is not a sign-out");
}

#[tokio::test]
async fn sign_out_clears_locally_attempts_revocation_and_offers_the_end_session_url() {
    let idp = Idp::start(TokenBehavior::Normal).await;
    let store = Arc::new(MemoryStore::default());
    let session = OidcSession::new(idp.config.clone(), store.clone()).unwrap();
    session
        .sign_in(&idp.browser(), &CancellationToken::new())
        .await
        .unwrap();

    let out = session.sign_out().await;

    assert!(store.load().unwrap().is_none());
    assert!(session.subject().is_none());
    // The library only revokes over https and this fake IdP speaks http, so the request itself is
    // not exercised here (UNVERIFIED against a real provider); the attempt is reported as Failed.
    assert_eq!(out.revocation, Revocation::Failed);
    let end = out.end_session_url.unwrap();
    assert!(
        end.path().ends_with("/logout")
            && end.query().unwrap().contains("client_id=desktop-client")
    );
}
