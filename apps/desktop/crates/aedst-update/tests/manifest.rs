#![allow(clippy::unwrap_used, clippy::expect_used)]
//! Signature verification, key rotation and the policy rules.

mod support;

use aedst_update::{
    KeyError, ManifestError, PersistedState, PolicyContext, PolicyError, TrustedKeys,
    check_freshness, decide, mark_seen, verify_manifest,
};
use ed25519_dalek::Signer;
use semver::Version;
use support::{NOW, Spec, envelope, signing_key, trusted};

#[test]
fn a_manifest_signed_by_a_trusted_key_verifies() {
    let key = signing_key();
    let manifest = verify_manifest(
        &Spec::default().signed_by(&[("k1", &key)]),
        &trusted(&[("k1", &key)]),
    )
    .unwrap();
    assert_eq!(manifest.version, Version::new(1, 1, 0));
    assert_eq!(manifest.channel, "stable");
}

#[test]
fn unsigned_wrongly_signed_and_tampered_manifests_are_refused() {
    let key = signing_key();
    let other = signing_key();
    let keys = trusted(&[("k1", &key)]);
    let spec = Spec::default();

    assert_eq!(
        verify_manifest(&spec.signed_by(&[]), &keys),
        Err(ManifestError::Unsigned)
    );
    assert_eq!(
        verify_manifest(&spec.signed_by(&[("k1", &other)]), &keys),
        Err(ManifestError::BadSignature),
        "signed by a key that is not the trusted one under that id"
    );
    assert_eq!(
        verify_manifest(&spec.signed_by(&[("k2", &key)]), &keys),
        Err(ManifestError::BadSignature),
        "right key, unknown id"
    );

    let signed = String::from_utf8(spec.signed_by(&[("k1", &key)])).unwrap();
    let tampered = signed.replace("1.1.0", "9.9.9");
    assert_eq!(
        verify_manifest(tampered.as_bytes(), &keys),
        Err(ManifestError::BadSignature)
    );

    // A signature over the bare payload (no domain separation) is not a manifest signature.
    let payload = spec.payload();
    let bare: String = key
        .sign(payload.as_bytes())
        .to_bytes()
        .iter()
        .map(|b| format!("{b:02x}"))
        .collect();
    let doc =
        serde_json::json!({"payload": payload, "signatures": [{"keyId": "k1", "signature": bare}]});
    assert_eq!(
        verify_manifest(doc.to_string().as_bytes(), &keys),
        Err(ManifestError::BadSignature)
    );

    let junk = serde_json::json!({"payload": spec.payload(), "signatures": [{"keyId": "k1", "signature": "zz"}]});
    assert_eq!(
        verify_manifest(junk.to_string().as_bytes(), &keys),
        Err(ManifestError::BadSignature)
    );
}

#[test]
fn malformed_oversized_and_keyless_input_is_refused() {
    let key = signing_key();
    let keys = trusted(&[("k1", &key)]);
    assert!(matches!(
        verify_manifest(b"not json", &keys),
        Err(ManifestError::Malformed(_))
    ));
    assert!(matches!(
        verify_manifest(b"{}", &keys),
        Err(ManifestError::Malformed(_))
    ));
    assert_eq!(verify_manifest(b"", &keys), Err(ManifestError::BadSize));
    assert_eq!(
        verify_manifest(&vec![b' '; 2 * 1024 * 1024], &keys),
        Err(ManifestError::BadSize)
    );
    let signed = Spec::default().signed_by(&[("k1", &key)]);
    assert_eq!(
        verify_manifest(&signed, &TrustedKeys::default()),
        Err(ManifestError::NoTrustedKeys)
    );
}

#[test]
fn a_correct_signature_does_not_excuse_an_invalid_manifest() {
    let key = signing_key();
    let keys = trusted(&[("k1", &key)]);
    let no_size = Spec {
        size: 0,
        ..Spec::default()
    };
    assert!(matches!(
        verify_manifest(&no_size.signed_by(&[("k1", &key)]), &keys),
        Err(ManifestError::InvalidManifest(_))
    ));
    let not_a_manifest = envelope("{\"hello\":1}", &[("k1", &key)]);
    assert!(matches!(
        verify_manifest(&not_a_manifest, &keys),
        Err(ManifestError::InvalidManifest(_))
    ));
}

#[test]
fn key_rotation_accepts_old_and_new_and_ignores_unknown_signers() {
    let old = signing_key();
    let new = signing_key();
    let stranger = signing_key();
    let both = trusted(&[("old", &old), ("new", &new)]);
    let spec = Spec::default();
    assert!(verify_manifest(&spec.signed_by(&[("old", &old)]), &both).is_ok());
    assert!(verify_manifest(&spec.signed_by(&[("new", &new)]), &both).is_ok());
    // A stranger's bad signature next to a good one does not spoil the envelope.
    assert!(
        verify_manifest(
            &spec.signed_by(&[("evil", &stranger), ("new", &new)]),
            &both
        )
        .is_ok()
    );
    // After the old key is dropped, its signatures stop working.
    let only_new = trusted(&[("new", &new)]);
    assert_eq!(
        verify_manifest(&spec.signed_by(&[("old", &old)]), &only_new),
        Err(ManifestError::BadSignature)
    );
}

#[test]
fn trusted_key_specs_are_parsed_strictly() {
    let key = signing_key().verifying_key().to_bytes();
    let hex: String = key.iter().map(|b| format!("{b:02x}")).collect();
    assert!(TrustedKeys::parse("").unwrap().is_empty());
    assert!(
        !TrustedKeys::parse(&format!("k1:{hex},k2:{hex}"))
            .unwrap()
            .is_empty()
    );
    assert_eq!(
        TrustedKeys::parse(&format!("k1:{hex},k1:{hex}")).unwrap_err(),
        KeyError::Duplicate
    );
    assert_eq!(TrustedKeys::parse("k1").unwrap_err(), KeyError::Syntax);
    assert_eq!(TrustedKeys::parse("k1:abcd").unwrap_err(), KeyError::Syntax);
    assert_eq!(
        TrustedKeys::parse(&format!("bad id:{hex}")).unwrap_err(),
        KeyError::KeyId
    );
}

fn manifest_of(spec: &Spec) -> aedst_update::Manifest {
    let key = signing_key();
    verify_manifest(&spec.signed_by(&[("k", &key)]), &trusted(&[("k", &key)])).unwrap()
}

fn context<'a>(installed: &'a Version, seen: &'a PersistedState) -> PolicyContext<'a> {
    PolicyContext {
        channel: "stable",
        installed,
        platform: "windows",
        arch: "x86_64",
        allow_downgrade: false,
        now: NOW,
        seen,
    }
}

#[test]
fn channel_expiry_and_dating_are_enforced() {
    let installed = Version::new(1, 0, 0);
    let seen = PersistedState::default();
    let ctx = context(&installed, &seen);

    let beta = manifest_of(&Spec {
        channel: "beta".to_owned(),
        ..Spec::default()
    });
    assert!(matches!(
        check_freshness(&beta, &ctx),
        Err(PolicyError::WrongChannel { .. })
    ));

    let expired = manifest_of(&Spec {
        expires_at: Some(NOW - 1),
        ..Spec::default()
    });
    assert_eq!(check_freshness(&expired, &ctx), Err(PolicyError::Expired));
    let live = manifest_of(&Spec {
        expires_at: Some(NOW + 60),
        ..Spec::default()
    });
    assert_eq!(check_freshness(&live, &ctx), Ok(()));

    let future = manifest_of(&Spec {
        published_at: NOW + 3 * 24 * 3600,
        ..Spec::default()
    });
    assert_eq!(
        check_freshness(&future, &ctx),
        Err(PolicyError::NotYetValid)
    );
}

#[test]
fn replay_and_rollback_protection() {
    let installed = Version::new(1, 5, 0);
    let seen = PersistedState {
        last_seen_published_at: NOW - 50,
        last_seen_version: Some("1.5.0".to_owned()),
        ..PersistedState::default()
    };
    let ctx = context(&installed, &seen);

    // An old manifest replayed by an attacker.
    let replay = manifest_of(&Spec {
        version: "1.4.0".to_owned(),
        published_at: NOW - 500,
        ..Spec::default()
    });
    assert_eq!(check_freshness(&replay, &ctx), Err(PolicyError::Replay));
    // Newer date but an older version without the rollback flag.
    let older = manifest_of(&Spec {
        version: "1.4.0".to_owned(),
        published_at: NOW - 10,
        ..Spec::default()
    });
    assert_eq!(
        check_freshness(&older, &ctx),
        Err(PolicyError::OlderThanSeen)
    );
    // A signed rollback must still be newer than everything seen.
    let stale_rollback = manifest_of(&Spec {
        version: "1.4.0".to_owned(),
        published_at: NOW - 500,
        rollback: true,
        ..Spec::default()
    });
    assert_eq!(
        check_freshness(&stale_rollback, &ctx),
        Err(PolicyError::Replay)
    );
    let rollback = manifest_of(&Spec {
        version: "1.4.0".to_owned(),
        published_at: NOW - 10,
        rollback: true,
        ..Spec::default()
    });
    assert_eq!(check_freshness(&rollback, &ctx), Ok(()));

    // The same manifest checked twice is not a replay.
    let same = manifest_of(&Spec {
        version: "1.5.0".to_owned(),
        published_at: NOW - 50,
        ..Spec::default()
    });
    assert_eq!(check_freshness(&same, &ctx), Ok(()));
    let after = mark_seen(&rollback, &seen);
    assert_eq!(after.last_seen_version.as_deref(), Some("1.4.0"));
    assert_eq!(after.last_seen_published_at, NOW - 10);
}

#[test]
fn downgrade_needs_a_signed_rollback() {
    let installed = Version::new(1, 5, 0);
    let seen = PersistedState::default();
    let ctx = context(&installed, &seen);

    let older = manifest_of(&Spec {
        version: "1.4.0".to_owned(),
        ..Spec::default()
    });
    assert_eq!(decide(&older, &ctx), Err(PolicyError::DowngradeRefused));

    let allowed = PolicyContext {
        allow_downgrade: true,
        ..ctx.clone()
    };
    let offer = decide(&older, &allowed).unwrap().unwrap();
    assert!(offer.is_downgrade && !offer.mandatory && !offer.rollback);

    let rollback = manifest_of(&Spec {
        version: "1.4.0".to_owned(),
        rollback: true,
        ..Spec::default()
    });
    let offer = decide(&rollback, &ctx).unwrap().unwrap();
    assert!(offer.is_downgrade && offer.rollback && offer.mandatory);
}

#[test]
fn up_to_date_mandatory_and_missing_artifact() {
    let seen = PersistedState::default();
    let installed = Version::new(1, 1, 0);
    assert_eq!(
        decide(&manifest_of(&Spec::default()), &context(&installed, &seen)),
        Ok(None)
    );

    let old = Version::new(1, 0, 0);
    let normal = decide(&manifest_of(&Spec::default()), &context(&old, &seen))
        .unwrap()
        .unwrap();
    assert!(!normal.mandatory && !normal.is_downgrade);

    let forced = Spec {
        min_supported: Some("1.0.5".to_owned()),
        ..Spec::default()
    };
    assert!(
        decide(&manifest_of(&forced), &context(&old, &seen))
            .unwrap()
            .unwrap()
            .mandatory
    );

    let ctx = PolicyContext {
        platform: "linux",
        ..context(&old, &seen)
    };
    assert_eq!(
        decide(&manifest_of(&Spec::default()), &ctx),
        Err(PolicyError::NoArtifact)
    );
}
