package apple_test

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"encoding/asn1"
	"encoding/base64"
	"encoding/pem"
	"fmt"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/fxamacker/cbor/v2"

	"github.com/aedst/server/internal/modules/appattest/appattesttest"
	"github.com/aedst/server/internal/modules/appattest/domain"
	"github.com/aedst/server/internal/modules/appattest/infrastructure/apple"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

const appID = "ABCDE12345.com.example.aedst"

func challenge() []byte { return bytes.Repeat([]byte{7}, 32) }

func hash(b []byte) []byte {
	h := sha256.Sum256(b)
	return h[:]
}

type env struct {
	pki *appattesttest.PKI
	dev *appattesttest.Device
	v   *apple.Verifier
}

func newEnv(t *testing.T) env {
	t.Helper()
	pki := appattesttest.NewPKI(t)
	return env{pki: pki, dev: pki.NewDevice(t), v: apple.NewVerifier(pki.Roots, sharedtime.Fixed{At: appattesttest.Now})}
}

func (e env) attest(t *testing.T, o appattesttest.AttestOpts) (domain.Attested, domain.Reason) {
	t.Helper()
	if o.AppID == "" {
		o.AppID = appID
	}
	if o.Challenge == nil {
		o.Challenge = challenge()
	}
	return e.v.VerifyAttestation(domain.AttestationInput{
		Object: e.dev.Attest(t, o), ClientDataHash: hash(challenge()), KeyID: e.dev.KeyID, AppID: appID,
	})
}

func TestVerifyAttestation_HappyPathProductionAndDevelopment(t *testing.T) {
	e := newEnv(t)
	got, reason := e.attest(t, appattesttest.AttestOpts{})
	if reason != domain.ReasonNone || got.Environment != domain.EnvironmentProduction {
		t.Fatalf("production = %+v, %q", got, reason)
	}
	if !got.PublicKey.Equal(&e.dev.Key.PublicKey) {
		t.Error("returned key is not the attested key")
	}
	got, reason = e.attest(t, appattesttest.AttestOpts{AAGUID: appattesttest.AAGUIDDevelopment})
	if reason != domain.ReasonNone || got.Environment != domain.EnvironmentDevelopment {
		t.Fatalf("development = %+v, %q", got, reason)
	}
}

func TestVerifyAttestation_Rejections(t *testing.T) {
	e := newEnv(t)
	other := appattesttest.NewPKI(t)
	otherDev := e.pki.NewDevice(t)
	tests := []struct {
		name string
		opts appattesttest.AttestOpts
		want domain.Reason
	}{
		{"wrong challenge", appattesttest.AttestOpts{Challenge: bytes.Repeat([]byte{9}, 32)}, domain.ReasonNonceMismatch},
		{"wrong nonce in the certificate", appattesttest.AttestOpts{Nonce: bytes.Repeat([]byte{1}, 32)}, domain.ReasonNonceMismatch},
		{"other team", appattesttest.AttestOpts{AppID: "ZZZZZ99999.com.example.aedst"}, domain.ReasonAppIDMismatch},
		{"other bundle", appattesttest.AttestOpts{AppID: "ABCDE12345.com.example.other"}, domain.ReasonAppIDMismatch},
		{"counter not zero", appattesttest.AttestOpts{Counter: 1}, domain.ReasonCounterNotZero},
		{"bad aaguid", appattesttest.AttestOpts{AAGUID: [16]byte{'n', 'o', 'p', 'e'}}, domain.ReasonAAGUIDInvalid},
		{"credential id is not the key id", appattesttest.AttestOpts{CredentialID: bytes.Repeat([]byte{3}, 32)}, domain.ReasonKeyIDMismatch},
		{"chain to another root", appattesttest.AttestOpts{SignWith: other}, domain.ReasonCertificateChain},
		{"missing intermediate", appattesttest.AttestOpts{OnlyLeaf: true}, domain.ReasonAttestationMalformed},
		{"wrong format", appattesttest.AttestOpts{Format: "packed"}, domain.ReasonAttestationMalformed},
		{"no attested credential data flag", appattesttest.AttestOpts{Flags: 0x01}, domain.ReasonAttestationMalformed},
		{"certificate expired", appattesttest.AttestOpts{NotBefore: appattesttest.Now.Add(-48 * time.Hour), NotAfter: appattesttest.Now.Add(-time.Hour)}, domain.ReasonCertificateChain},
		{"certificate not yet valid", appattesttest.AttestOpts{NotBefore: appattesttest.Now.Add(time.Hour), NotAfter: appattesttest.Now.Add(48 * time.Hour)}, domain.ReasonCertificateChain},
		{"no nonce extension", appattesttest.AttestOpts{OmitNonceExtension: true}, domain.ReasonAttestationMalformed},
		{"nonce extension without the [1] wrapper", appattesttest.AttestOpts{RawNonceExtension: mustDER(asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSequence, IsCompound: true, Bytes: mustDER([]byte{1, 2, 3})})}, domain.ReasonAttestationMalformed},
		{"nonce extension with trailing bytes", appattesttest.AttestOpts{RawNonceExtension: append(wrappedNonce(bytes.Repeat([]byte{1}, 32)), 0x00)}, domain.ReasonAttestationMalformed},
		{"nonce extension with a second element", appattesttest.AttestOpts{RawNonceExtension: mustDER(asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSequence, IsCompound: true, Bytes: append(wrappedNonceInner(bytes.Repeat([]byte{1}, 32)), mustDER([]byte{9})...)})}, domain.ReasonAttestationMalformed},
		{"nonce of the wrong length", appattesttest.AttestOpts{RawNonceExtension: wrappedNonce([]byte{1, 2, 3})}, domain.ReasonNonceMismatch},
		{"nonce extension is garbage", appattesttest.AttestOpts{RawNonceExtension: []byte{0xde, 0xad}}, domain.ReasonAttestationMalformed},
		{"certificate key is not the device key (key id mismatch)", appattesttest.AttestOpts{LeafKey: &otherDev.Key.PublicKey}, domain.ReasonKeyIDMismatch},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if _, reason := e.attest(t, tt.opts); reason != tt.want {
				t.Fatalf("reason = %q, want %q", reason, tt.want)
			}
		})
	}
}

// wrappedNonceInner is the DER of [1] EXPLICIT { OCTET STRING nonce }.
func wrappedNonceInner(nonce []byte) []byte {
	return mustDER(asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 1, IsCompound: true, Bytes: mustDER(nonce)})
}

// wrappedNonce is the DER of SEQUENCE { [1] EXPLICIT { OCTET STRING nonce } }.
func wrappedNonce(nonce []byte) []byte {
	return mustDER(asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSequence, IsCompound: true, Bytes: wrappedNonceInner(nonce)})
}

func mustDER(v any) []byte {
	b, err := asn1.Marshal(v)
	if err != nil {
		panic(err)
	}
	return b
}

func TestVerifyAttestation_SuppliedKeyIDMustMatch(t *testing.T) {
	e := newEnv(t)
	obj := e.dev.Attest(t, appattesttest.AttestOpts{AppID: appID, Challenge: challenge()})
	wrong := sha256.Sum256([]byte("another key"))
	if _, reason := e.v.VerifyAttestation(domain.AttestationInput{Object: obj, ClientDataHash: hash(challenge()), KeyID: wrong[:], AppID: appID}); reason != domain.ReasonKeyIDMismatch {
		t.Fatalf("reason = %q, want key_id_mismatch", reason)
	}
}

func TestVerifyAttestation_MalformedInput(t *testing.T) {
	e := newEnv(t)
	good := e.dev.Attest(t, appattesttest.AttestOpts{AppID: appID, Challenge: challenge()})
	cases := map[string][]byte{
		"empty":              {},
		"not cbor":           []byte("hello"),
		"truncated":          good[:len(good)/2],
		"trailing data":      append(append([]byte{}, good...), 0x00),
		"cbor but not a map": mustCBOR(t, []int{1, 2, 3}),
		"unrelated map":      mustCBOR(t, map[string]any{"x": 1}),
		"authData too short": mustCBOR(t, map[string]any{
			"fmt": "apple-appattest", "attStmt": map[string]any{"x5c": [][]byte{{1}, {2}}}, "authData": []byte{1, 2, 3},
		}),
		"garbage certificates": mustCBOR(t, map[string]any{
			"fmt": "apple-appattest", "attStmt": map[string]any{"x5c": [][]byte{{1}, {2}}}, "authData": bytes.Repeat([]byte{0x40}, 80),
		}),
		"deeply nested": bytes.Repeat([]byte{0x81}, 5000),
	}
	for name, obj := range cases {
		t.Run(name, func(t *testing.T) {
			_, reason := e.v.VerifyAttestation(domain.AttestationInput{Object: obj, ClientDataHash: hash(challenge()), KeyID: e.dev.KeyID, AppID: appID})
			if reason != domain.ReasonAttestationMalformed {
				t.Fatalf("reason = %q, want attestation_malformed", reason)
			}
		})
	}
}

func mustCBOR(t *testing.T, v any) []byte {
	t.Helper()
	b, err := cbor.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

func TestVerifyAttestation_CBORTagsAreRejected(t *testing.T) {
	e := newEnv(t)
	good := e.dev.Attest(t, appattesttest.AttestOpts{AppID: appID, Challenge: challenge()})
	in := domain.AttestationInput{ClientDataHash: hash(challenge()), KeyID: e.dev.KeyID, AppID: appID}
	in.Object = good
	if _, reason := e.v.VerifyAttestation(in); reason != domain.ReasonNone {
		t.Fatalf("untagged object = %q", reason)
	}
	// Wrap the whole object in tag 55799 (self-described CBOR): valid CBOR, never sent by Apple.
	in.Object = append([]byte{0xd9, 0xd9, 0xf7}, good...)
	if _, reason := e.v.VerifyAttestation(in); reason != domain.ReasonAttestationMalformed {
		t.Fatalf("tagged object = %q, want attestation_malformed", reason)
	}
}

func TestVerifyAttestation_DuplicateMapKeysAreRejected(t *testing.T) {
	// {"fmt": "apple-appattest", "fmt": "apple-appattest", ...} must not be accepted.
	obj := []byte{0xa4, 0x63, 'f', 'm', 't', 0x6f}
	obj = append(obj, "apple-appattest"...)
	obj = append(obj, 0x63, 'f', 'm', 't', 0x6f)
	obj = append(obj, "apple-appattest"...)
	e := newEnv(t)
	if _, reason := e.v.VerifyAttestation(domain.AttestationInput{Object: obj, ClientDataHash: hash(challenge()), KeyID: e.dev.KeyID, AppID: appID}); reason != domain.ReasonAttestationMalformed {
		t.Fatalf("reason = %q", reason)
	}
}

func TestVerifyAssertion(t *testing.T) {
	e := newEnv(t)
	pub := &e.dev.Key.PublicKey
	action, payload := "login", []byte("nonce-1")
	cdh := domain.ClientDataHash(action, payload)
	in := func(obj []byte) domain.AssertionInput {
		return domain.AssertionInput{Object: obj, ClientDataHash: cdh, PublicKey: pub, AppID: appID}
	}

	t.Run("happy path returns the counter", func(t *testing.T) {
		counter, reason := e.v.VerifyAssertion(in(e.dev.Assert(t, appID, 5, action, payload)))
		if reason != domain.ReasonNone || counter != 5 {
			t.Fatalf("= %d, %q", counter, reason)
		}
	})
	t.Run("different payload", func(t *testing.T) {
		if _, reason := e.v.VerifyAssertion(in(e.dev.Assert(t, appID, 5, action, []byte("other")))); reason != domain.ReasonSignatureInvalid {
			t.Fatalf("reason = %q", reason)
		}
	})
	t.Run("different action", func(t *testing.T) {
		if _, reason := e.v.VerifyAssertion(in(e.dev.Assert(t, appID, 5, "purchase", payload))); reason != domain.ReasonSignatureInvalid {
			t.Fatalf("reason = %q", reason)
		}
	})
	t.Run("other app id", func(t *testing.T) {
		if _, reason := e.v.VerifyAssertion(in(e.dev.Assert(t, "ABCDE12345.com.example.other", 5, action, payload))); reason != domain.ReasonAppIDMismatch {
			t.Fatalf("reason = %q", reason)
		}
	})
	t.Run("signed by another key", func(t *testing.T) {
		stranger := e.pki.NewDevice(t)
		if _, reason := e.v.VerifyAssertion(in(stranger.Assert(t, appID, 5, action, payload))); reason != domain.ReasonSignatureInvalid {
			t.Fatalf("reason = %q", reason)
		}
	})
	t.Run("counter tampered after signing", func(t *testing.T) {
		var obj struct {
			Signature         []byte `cbor:"signature"`
			AuthenticatorData []byte `cbor:"authenticatorData"`
		}
		if err := cbor.Unmarshal(e.dev.Assert(t, appID, 5, action, payload), &obj); err != nil {
			t.Fatal(err)
		}
		obj.AuthenticatorData[36] = 9
		if _, reason := e.v.VerifyAssertion(in(mustCBOR(t, obj))); reason != domain.ReasonSignatureInvalid {
			t.Fatalf("reason = %q", reason)
		}
	})
	t.Run("signature tampered", func(t *testing.T) {
		var obj struct {
			Signature         []byte `cbor:"signature"`
			AuthenticatorData []byte `cbor:"authenticatorData"`
		}
		if err := cbor.Unmarshal(e.dev.Assert(t, appID, 5, action, payload), &obj); err != nil {
			t.Fatal(err)
		}
		obj.Signature[len(obj.Signature)-1] ^= 0xff
		if _, reason := e.v.VerifyAssertion(in(mustCBOR(t, obj))); reason != domain.ReasonSignatureInvalid {
			t.Fatalf("reason = %q", reason)
		}
	})
	t.Run("signed over the nonce directly (a single SHA-256) is not accepted", func(t *testing.T) {
		// Apple's signature covers SHA-256(nonce): a signature over the nonce alone must fail.
		authData := appattesttest.AssertionAuthData(appID, 5)
		nonce := sha256.Sum256(append(append([]byte{}, authData...), cdh[:]...))
		sig, err := signASN1(e.dev, nonce[:])
		if err != nil {
			t.Fatal(err)
		}
		obj := mustCBOR(t, map[string]any{"signature": sig, "authenticatorData": authData})
		if _, reason := e.v.VerifyAssertion(in(obj)); reason != domain.ReasonSignatureInvalid {
			t.Fatalf("reason = %q", reason)
		}
	})
	t.Run("malformed", func(t *testing.T) {
		for name, obj := range map[string][]byte{
			"empty":          {},
			"garbage":        []byte("garbage"),
			"no signature":   mustCBOR(t, map[string]any{"authenticatorData": appattesttest.AssertionAuthData(appID, 1)}),
			"short authdata": mustCBOR(t, map[string]any{"signature": []byte{1}, "authenticatorData": []byte{1, 2}}),
		} {
			if _, reason := e.v.VerifyAssertion(in(obj)); reason != domain.ReasonAssertionMalformed {
				t.Errorf("%s: reason = %q", name, reason)
			}
		}
	})
}

// The real Apple root CA is embedded and pinned.
func TestAppleRoots_PinnedFingerprintAndSubject(t *testing.T) {
	pool, err := apple.AppleRoots()
	if err != nil {
		t.Fatal(err)
	}
	subjects := pool.Subjects() //nolint:staticcheck // only to inspect the single embedded root
	if len(subjects) != 1 {
		t.Fatalf("%d roots, want 1", len(subjects))
	}
	raw, err := os.ReadFile("Apple_App_Attestation_Root_CA.pem")
	if err != nil {
		t.Fatal(err)
	}
	block, _ := pem.Decode(raw)
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		t.Fatal(err)
	}
	if got := cert.Subject.CommonName; got != "Apple App Attestation Root CA" {
		t.Errorf("CN = %q", got)
	}
	if cert.NotBefore.UTC() != time.Date(2020, 3, 18, 18, 32, 53, 0, time.UTC) || cert.NotAfter.UTC() != time.Date(2045, 3, 15, 0, 0, 0, 0, time.UTC) {
		t.Errorf("validity = %v .. %v", cert.NotBefore, cert.NotAfter)
	}
	sum := sha256.Sum256(cert.Raw)
	// openssl x509 -fingerprint -sha256: 1C:B9:82:3B:A2:8B:A6:AD:2D:33:A0:06:94:1D:E2:AE:4F:51:3E:F1:D4:E8:31:B9:F7:E0:FA:7B:62:42:C9:32
	got := fmt.Sprintf("%x", sum)
	if got != "1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932" {
		t.Errorf("fingerprint = %s", got)
	}
	if got != apple.RootCAFingerprint {
		t.Errorf("RootCAFingerprint constant = %s, certificate = %s", apple.RootCAFingerprint, got)
	}
}

// The attestation object published in Apple's validation guide (as reproduced
// in the MIT-licensed github.com/takimoto3/app-attest test data) was issued by
// the real App Attestation CA 1 and chains to the real Apple root. Its
// certificates are valid 2026-04-20 .. 2026-04-23, so the verifier clock is
// pinned inside that window. This is the only check against genuine Apple
// output in this repository.
func TestVerifyAttestation_AppleGuideSample(t *testing.T) {
	raw, err := os.ReadFile("testdata/apple_guide_attestation.b64")
	if err != nil {
		t.Fatal(err)
	}
	obj, err := base64.StdEncoding.DecodeString(strings.TrimSpace(string(raw)))
	if err != nil {
		t.Fatal(err)
	}
	roots, err := apple.AppleRoots()
	if err != nil {
		t.Fatal(err)
	}
	const sampleAppID = "1234567890.com.example.myapp"
	// The sample passed this 24-byte string to attestKey as the clientDataHash itself, unhashed.
	const sampleChallenge = "example_server_challenge"
	keyID := sampleKeyID(t, obj)

	at := func(ts time.Time) (domain.Attested, domain.Reason) {
		v := apple.NewVerifier(roots, sharedtime.Fixed{At: ts})
		return v.VerifyAttestation(domain.AttestationInput{Object: obj, ClientDataHash: []byte(sampleChallenge), KeyID: keyID, AppID: sampleAppID})
	}
	got, reason := at(time.Date(2026, 4, 21, 12, 0, 0, 0, time.UTC))
	if reason != domain.ReasonNone {
		t.Fatalf("real Apple sample rejected: %q", reason)
	}
	if got.Environment != domain.EnvironmentProduction {
		t.Errorf("environment = %q", got.Environment)
	}
	if _, reason := at(time.Date(2026, 5, 21, 12, 0, 0, 0, time.UTC)); reason != domain.ReasonCertificateChain {
		t.Errorf("after the certificate expired: %q, want certificate_chain_invalid", reason)
	}
	v := apple.NewVerifier(roots, sharedtime.Fixed{At: time.Date(2026, 4, 21, 12, 0, 0, 0, time.UTC)})
	if _, reason := v.VerifyAttestation(domain.AttestationInput{Object: obj, ClientDataHash: []byte("another challenge"), KeyID: keyID, AppID: sampleAppID}); reason != domain.ReasonNonceMismatch {
		t.Errorf("wrong challenge: %q", reason)
	}
	if _, reason := v.VerifyAttestation(domain.AttestationInput{Object: obj, ClientDataHash: []byte(sampleChallenge), KeyID: keyID, AppID: "1234567890.com.example.other"}); reason != domain.ReasonAppIDMismatch {
		t.Errorf("wrong app id: %q", reason)
	}
}

// sampleKeyID derives the key id (credentialId) from the sample's authData.
func sampleKeyID(t *testing.T, obj []byte) []byte {
	t.Helper()
	var a struct {
		AuthData []byte `cbor:"authData"`
	}
	if err := cbor.Unmarshal(obj, &a); err != nil {
		t.Fatal(err)
	}
	ad, err := domain.ParseAttestationAuthData(a.AuthData)
	if err != nil {
		t.Fatal(err)
	}
	return ad.CredentialID
}

// signASN1 signs digest with the device key directly (no extra hashing).
func signASN1(d *appattesttest.Device, digest []byte) ([]byte, error) {
	return ecdsa.SignASN1(rand.Reader, d.Key, digest)
}
