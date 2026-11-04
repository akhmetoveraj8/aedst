//! Replays `docs/contract/behavior/session-refresh.json`, the fixture shared with every client.
//!
//! The token source here models the single-flight rule that `OidcSession` implements (and tests
//! itself in `aedst-oidc`): a caller that finds the token already rotated while it waited for the
//! gate shares that refresh instead of making its own.
#![allow(clippy::unwrap_used, clippy::expect_used)] // test code: a panic is the failure report

use std::{
    collections::VecDeque,
    sync::{
        Arc, Mutex,
        atomic::{AtomicUsize, Ordering},
    },
};

use aedst_api::{ApiError, TokenFailure, TokenSource, call_authenticated};
use connectrpc::ConnectError;
use futures::future::BoxFuture;
use serde_json::Value;
use tokio::sync::Mutex as AsyncMutex;

const FIXTURE: &str = concat!(
    env!("CARGO_MANIFEST_DIR"),
    "/../../../../docs/contract/behavior/session-refresh.json"
);

struct Fake {
    generation: Mutex<u32>,
    signed_in: Mutex<bool>,
    outcomes: Mutex<VecDeque<String>>,
    refresh_calls: AtomicUsize,
    gate: AsyncMutex<()>,
}

impl Fake {
    fn token(&self) -> String {
        format!("token-{}", self.generation.lock().unwrap())
    }
}

impl TokenSource for Fake {
    fn access_token(&self) -> BoxFuture<'_, Result<String, TokenFailure>> {
        Box::pin(async move { Ok(self.token()) })
    }

    fn refresh_after_rejection(&self) -> BoxFuture<'_, Result<String, TokenFailure>> {
        Box::pin(async move {
            let seen = *self.generation.lock().unwrap();
            let _gate = self.gate.lock().await;
            if *self.generation.lock().unwrap() != seen {
                return Ok(self.token()); // another caller refreshed while we waited
            }
            self.refresh_calls.fetch_add(1, Ordering::SeqCst);
            tokio::task::yield_now().await;
            let outcome = self
                .outcomes
                .lock()
                .unwrap()
                .pop_front()
                .expect("refresh outcome");
            match outcome.as_str() {
                "ok" => {
                    *self.generation.lock().unwrap() += 1;
                    Ok(self.token())
                }
                "invalid_grant" => {
                    *self.signed_in.lock().unwrap() = false;
                    Err(TokenFailure::SessionEnded)
                }
                _ => Err(TokenFailure::Transient),
            }
        })
    }
}

#[tokio::test]
async fn every_case_of_the_shared_fixture_passes() {
    let fixture: Value =
        serde_json::from_str(&std::fs::read_to_string(FIXTURE).expect("fixture")).unwrap();

    for case in fixture["cases"].as_array().unwrap() {
        let name = case["id"].as_str().unwrap();
        let fake = Arc::new(Fake {
            generation: Mutex::new(0),
            signed_in: Mutex::new(true),
            outcomes: Mutex::new(
                case["refresh"]
                    .as_array()
                    .unwrap()
                    .iter()
                    .map(|o| o.as_str().unwrap().to_owned())
                    .collect(),
            ),
            refresh_calls: AtomicUsize::new(0),
            gate: AsyncMutex::new(()),
        });

        let mut jobs = Vec::new();
        for request in case["requests"].as_array().unwrap() {
            let id = request["id"].as_str().unwrap().to_owned();
            let script: Vec<u64> = request["server"]
                .as_array()
                .unwrap()
                .iter()
                .map(|c| c.as_u64().unwrap())
                .collect();
            let fake = Arc::clone(&fake);
            jobs.push(tokio::spawn(async move {
                let calls = AtomicUsize::new(0);
                let result = call_authenticated(fake.as_ref(), |_options| {
                    let n = calls.fetch_add(1, Ordering::SeqCst);
                    let status = script[n.min(script.len() - 1)];
                    async move {
                        if status == 401 {
                            Err(ConnectError::unauthenticated("expired"))
                        } else {
                            Ok(())
                        }
                    }
                })
                .await;
                let outcome = match result {
                    Ok(()) => "ok",
                    Err(ApiError::Unauthenticated) => "unauthenticated",
                    Err(ApiError::Retryable) => "retryable_error",
                    Err(ApiError::Connect(_)) => "other",
                };
                (id, outcome, calls.load(Ordering::SeqCst).saturating_sub(1))
            }));
        }

        let expect = &case["expect"];
        for job in jobs {
            let (id, outcome, replays) = job.await.unwrap();
            assert_eq!(
                outcome,
                expect["results"][&id].as_str().unwrap(),
                "{name}: result of {id}"
            );
            assert_eq!(
                replays as u64,
                expect["replays"][&id].as_u64().unwrap(),
                "{name}: replays of {id}"
            );
        }
        assert_eq!(
            fake.refresh_calls.load(Ordering::SeqCst) as u64,
            expect["refreshCalls"].as_u64().unwrap(),
            "{name}: refresh calls"
        );
        let session = if *fake.signed_in.lock().unwrap() {
            "signed_in"
        } else {
            "signed_out"
        };
        assert_eq!(
            session,
            expect["session"].as_str().unwrap(),
            "{name}: session"
        );
    }
}
