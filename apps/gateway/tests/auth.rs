#![allow(clippy::expect_used, clippy::unwrap_used)]
//! Token verification against a key set built in the test (the private key is generated at run
//! time; none is stored in the repository).

use std::time::Duration;

use aedst_gateway::auth::{AuthError, user_id_for, verify_with};
use aedst_gateway::config::OidcConfig;
use base64::Engine as _;
use base64::engine::general_purpose::URL_SAFE_NO_PAD;
use ed25519_dalek::SigningKey;
use ed25519_dalek::pkcs8::EncodePrivateKey;
use jsonwebtoken::jwk::JwkSet;
use jsonwebtoken::{Algorithm, EncodingKey, Header, encode};
use serde_json::json;

const ISSUER: &str = "https://idp.example";
const AUDIENCE: &str = "aedst-api";

fn config() -> OidcConfig {
    OidcConfig {
        issuer: ISSUER.into(),
        audience: AUDIENCE.into(),
        jwks_url: None,
        algorithms: vec![Algorithm::RS256, Algorithm::ES256, Algorithm::EdDSA],
        token_types: vec!["at+jwt".into(), "JWT".into()],
        clock_skew: Duration::from_secs(30),
    }
}

fn now() -> u64 {
    aedst_gateway::auth::now_secs()
}

struct Keys {
    signing: EncodingKey,
    set: JwkSet,
}

fn encoding_key(signing: &SigningKey) -> EncodingKey {
    let der = signing.to_pkcs8_der().expect("pkcs8");
    EncodingKey::from_ed_der(der.as_bytes())
}

fn keys() -> Keys {
    let mut seed = [0u8; 32];
    seed.iter_mut()
        .enumerate()
        .for_each(|(i, b)| *b = u8::try_from(i * 7 + 1).unwrap_or(1));
    let signing = SigningKey::from_bytes(&seed);
    let x = URL_SAFE_NO_PAD.encode(signing.verifying_key().as_bytes());
    let set = serde_json::from_value(json!({
        "keys": [{"kty": "OKP", "crv": "Ed25519", "alg": "EdDSA", "use": "sig", "kid": "k1", "x": x}]
    }))
    .expect("jwks");
    Keys {
        signing: encoding_key(&signing),
        set,
    }
}

fn token(keys: &Keys, typ: &str, claims: &serde_json::Value) -> String {
    let mut header = Header::new(Algorithm::EdDSA);
    header.kid = Some("k1".into());
    header.typ = Some(typ.into());
    encode(&header, claims, &keys.signing).expect("sign")
}

fn claims(exp: u64) -> serde_json::Value {
    json!({"iss": ISSUER, "aud": AUDIENCE, "sub": "312345678901230000", "exp": exp})
}

fn claims_for(issuer: &str, audience: &str) -> serde_json::Value {
    json!({"iss": issuer, "aud": audience, "sub": "u", "exp": now() + 600})
}

#[test]
fn a_valid_token_yields_the_go_compatible_owner_id() {
    let k = keys();
    let exp = now() + 600;
    let tok = token(&k, "at+jwt", &claims(exp));
    let principal = verify_with(&config(), &tok, Some("k1"), &k.set)
        .expect("valid")
        .expect("key found");
    assert_eq!(principal.user_id, user_id_for(ISSUER, "312345678901230000"));
    assert_eq!(principal.expires_at, exp);
}

#[test]
fn refused_tokens() {
    let k = keys();
    let cfg = config();
    let ok = claims(now() + 600);
    let cases: Vec<(&str, String)> = vec![
        ("expired", token(&k, "at+jwt", &claims(now() - 600))),
        (
            "wrong audience",
            token(&k, "at+jwt", &claims_for(ISSUER, "other")),
        ),
        (
            "wrong issuer",
            token(&k, "at+jwt", &claims_for("https://evil", AUDIENCE)),
        ),
        ("id token typ", token(&k, "id+jwt", &ok)),
        ("garbage", "not.a.jwt".into()),
    ];
    for (name, tok) in cases {
        let result = verify_with(&cfg, &tok, Some("k1"), &k.set);
        assert!(matches!(result, Err(AuthError::Invalid(_))), "{name}");
    }
}

#[test]
fn an_unknown_kid_asks_the_caller_to_refresh_the_keys() {
    let k = keys();
    let tok = token(&k, "at+jwt", &claims(now() + 600));
    let result = verify_with(&config(), &tok, Some("rotated"), &k.set);
    assert!(matches!(result, Ok(None)));
}

#[test]
fn a_token_signed_by_another_key_is_refused() {
    let genuine = keys();
    let mut other_seed = [9u8; 32];
    other_seed[0] = 1;
    let forged = Keys {
        signing: encoding_key(&SigningKey::from_bytes(&other_seed)),
        set: genuine.set.clone(),
    };
    let tok = token(&forged, "at+jwt", &claims(now() + 600));
    let result = verify_with(&config(), &tok, Some("k1"), &genuine.set);
    assert!(matches!(result, Err(AuthError::Invalid(_))));
}
