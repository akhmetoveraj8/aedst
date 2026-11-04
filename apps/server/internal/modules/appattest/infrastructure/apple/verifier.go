// Package apple validates Apple App Attest attestation and assertion objects
// following Apple's "Validating apps that connect to your server" checklist.
//
// It is project-specific security logic written on top of encoding/asn1,
// crypto/x509 and crypto/ecdsa from the standard library and
// fxamacker/cbor for CBOR (see ADR-0016 for why no App Attest library is
// used). The Apple root CA and the clock are injected, so tests run with a
// synthetic PKI and a fixed time.
//
// Out of scope: Apple's receipt (fraud-risk metric) is ignored, and the
// optional authenticator-data extensions (bundle version, validation category)
// are not evaluated.
package apple

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/sha256"
	"crypto/subtle"
	"crypto/x509"
	_ "embed"
	"encoding/asn1"
	"encoding/hex"
	"encoding/pem"
	"errors"
	"fmt"

	"github.com/fxamacker/cbor/v2"

	"github.com/aedst/server/internal/modules/appattest/domain"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// RootCAFingerprint is the SHA-256 fingerprint of the embedded Apple App
// Attestation Root CA (CN=Apple App Attestation Root CA, O=Apple Inc.,
// ST=California; valid 2020-03-18 to 2045-03-15; ECDSA P-384), downloaded from
// https://www.apple.com/certificateauthority/Apple_App_Attestation_Root_CA.pem.
const RootCAFingerprint = "1cb9823ba28ba6ad2d33a006941de2ae4f513ef1d4e831b9f7e0fa7b6242c932"

//go:embed Apple_App_Attestation_Root_CA.pem
var appleRootPEM []byte

// AppleRoots returns a pool holding only the embedded Apple App Attestation Root CA.
func AppleRoots() (*x509.CertPool, error) {
	block, _ := pem.Decode(appleRootPEM)
	if block == nil {
		return nil, errors.New("appattest: embedded Apple root CA is not PEM")
	}
	cert, err := x509.ParseCertificate(block.Bytes)
	if err != nil {
		return nil, fmt.Errorf("appattest: embedded Apple root CA: %w", err)
	}
	if fp := sha256.Sum256(cert.Raw); hex.EncodeToString(fp[:]) != RootCAFingerprint {
		return nil, errors.New("appattest: embedded Apple root CA does not match its pinned fingerprint")
	}
	pool := x509.NewCertPool()
	pool.AddCert(cert)
	return pool, nil
}

// nonceOID is the credCert extension that carries the attestation nonce.
var nonceOID = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 8, 2}

const (
	fmtAppleAppAttest = "apple-appattest"
	maxChainLength    = 4
)

// Verifier validates attestations and assertions. It is stateless and safe for
// concurrent use.
type Verifier struct {
	roots *x509.CertPool
	clock sharedtime.Clock
}

// NewVerifier builds a Verifier trusting only roots (use AppleRoots in
// production). Certificate validity is judged at clock.Now().
func NewVerifier(roots *x509.CertPool, clock sharedtime.Clock) *Verifier {
	return &Verifier{roots: roots, clock: clock}
}

type attestationObject struct {
	Fmt     string `cbor:"fmt"`
	AttStmt struct {
		X5C     [][]byte `cbor:"x5c"`
		Receipt []byte   `cbor:"receipt"`
	} `cbor:"attStmt"`
	AuthData []byte `cbor:"authData"`
}

type assertionObject struct {
	Signature         []byte `cbor:"signature"`
	AuthenticatorData []byte `cbor:"authenticatorData"`
}

// decMode bounds what an attacker-supplied CBOR object can cost: shallow
// nesting, few elements, no duplicate map keys, no indefinite-length items, no tags.
var decMode = mustDecMode()

func mustDecMode() cbor.DecMode {
	m, err := cbor.DecOptions{
		DupMapKey:        cbor.DupMapKeyEnforcedAPF,
		MaxNestedLevels:  8,
		MaxArrayElements: 16,
		MaxMapPairs:      16,
		IndefLength:      cbor.IndefLengthForbidden,
		// Apple's objects use no CBOR tags; a tag only widens the decoder surface.
		TagsMd: cbor.TagsForbidden,
	}.DecMode()
	if err != nil {
		panic(err)
	}
	return m
}

// VerifyAttestation runs Apple's attestation checklist.
func (v *Verifier) VerifyAttestation(in domain.AttestationInput) (domain.Attested, domain.Reason) {
	var obj attestationObject
	if err := decMode.Unmarshal(in.Object, &obj); err != nil || obj.Fmt != fmtAppleAppAttest {
		return domain.Attested{}, domain.ReasonAttestationMalformed
	}
	if n := len(obj.AttStmt.X5C); n < 2 || n > maxChainLength {
		return domain.Attested{}, domain.ReasonAttestationMalformed
	}
	authData, err := domain.ParseAttestationAuthData(obj.AuthData)
	if err != nil {
		return domain.Attested{}, domain.ReasonAttestationMalformed
	}

	// 1. Chain: credCert -> intermediate -> Apple App Attestation Root CA.
	credCert, err := x509.ParseCertificate(obj.AttStmt.X5C[0])
	if err != nil {
		return domain.Attested{}, domain.ReasonAttestationMalformed
	}
	intermediates := x509.NewCertPool()
	for _, der := range obj.AttStmt.X5C[1:] {
		c, err := x509.ParseCertificate(der)
		if err != nil {
			return domain.Attested{}, domain.ReasonAttestationMalformed
		}
		intermediates.AddCert(c)
	}
	// App Attest certificates are attestation credentials, not TLS server
	// certificates: do not apply the default ServerAuth key-usage policy.
	if _, err := credCert.Verify(x509.VerifyOptions{
		Roots:         v.roots,
		Intermediates: intermediates,
		CurrentTime:   v.clock.Now(),
		KeyUsages:     []x509.ExtKeyUsage{x509.ExtKeyUsageAny},
	}); err != nil {
		return domain.Attested{}, domain.ReasonCertificateChain
	}

	// 2-4. nonce = SHA256(authData || clientDataHash) must be the value in
	// the credCert extension 1.2.840.113635.100.8.2.
	h := sha256.New()
	h.Write(obj.AuthData)
	h.Write(in.ClientDataHash)
	nonce := h.Sum(nil)
	certNonce, err := nonceFromCertificate(credCert)
	if err != nil {
		return domain.Attested{}, domain.ReasonAttestationMalformed
	}
	if subtle.ConstantTimeCompare(nonce, certNonce) != 1 {
		return domain.Attested{}, domain.ReasonNonceMismatch
	}

	// 5. SHA256 of the uncompressed public key equals the key identifier.
	pub, ok := credCert.PublicKey.(*ecdsa.PublicKey)
	if !ok || pub.Curve != elliptic.P256() {
		return domain.Attested{}, domain.ReasonAttestationMalformed
	}
	gotKeyID, err := domain.KeyIDOf(pub)
	if err != nil {
		return domain.Attested{}, domain.ReasonAttestationMalformed
	}
	if subtle.ConstantTimeCompare(gotKeyID, in.KeyID) != 1 {
		return domain.Attested{}, domain.ReasonKeyIDMismatch
	}

	// 6-9. RP ID hash, counter, aaguid, credentialId.
	env, reason := domain.JudgeAttestation(authData, in.AppID, in.KeyID)
	if reason != domain.ReasonNone {
		return domain.Attested{}, reason
	}
	return domain.Attested{PublicKey: pub, Environment: env}, domain.ReasonNone
}

// nonceFromCertificate extracts the nonce: the extension value is the DER of
//
//	SEQUENCE { [1] EXPLICIT { OCTET STRING nonce } }
//
// and every level must be consumed exactly.
func nonceFromCertificate(cert *x509.Certificate) ([]byte, error) {
	var value []byte
	for _, ext := range cert.Extensions {
		if ext.Id.Equal(nonceOID) {
			value = ext.Value
			break
		}
	}
	if value == nil {
		return nil, errors.New("appattest: credential certificate has no nonce extension")
	}
	var seq asn1.RawValue
	if rest, err := asn1.Unmarshal(value, &seq); err != nil || len(rest) != 0 ||
		seq.Class != asn1.ClassUniversal || seq.Tag != asn1.TagSequence || !seq.IsCompound {
		return nil, errors.New("appattest: nonce extension is not a sequence")
	}
	var tagged asn1.RawValue
	if rest, err := asn1.Unmarshal(seq.Bytes, &tagged); err != nil || len(rest) != 0 ||
		tagged.Class != asn1.ClassContextSpecific || tagged.Tag != 1 || !tagged.IsCompound {
		return nil, errors.New("appattest: nonce extension has no [1] element")
	}
	var nonce []byte
	if rest, err := asn1.Unmarshal(tagged.Bytes, &nonce); err != nil || len(rest) != 0 {
		return nil, errors.New("appattest: nonce is not an octet string")
	}
	return nonce, nil
}

// VerifyAssertion runs Apple's assertion checklist except the counter freshness
// (stateful, done by the key store): RP ID hash, then the signature over
// SHA256(SHA256(authenticatorData || clientDataHash)). Apple says the signature
// must be valid for the nonce SHA256(authenticatorData || clientDataHash); the
// Secure Enclave key signs with ECDSA-SHA256, i.e. over the SHA-256 of that nonce.
func (v *Verifier) VerifyAssertion(in domain.AssertionInput) (uint32, domain.Reason) {
	if in.PublicKey == nil {
		return 0, domain.ReasonKeyUnknown
	}
	var obj assertionObject
	if err := decMode.Unmarshal(in.Object, &obj); err != nil || len(obj.Signature) == 0 {
		return 0, domain.ReasonAssertionMalformed
	}
	authData, err := domain.ParseAssertionAuthData(obj.AuthenticatorData)
	if err != nil {
		return 0, domain.ReasonAssertionMalformed
	}
	if want := domain.RPIDHash(in.AppID); !bytes.Equal(authData.RPIDHash[:], want[:]) {
		return 0, domain.ReasonAppIDMismatch
	}
	h := sha256.New()
	h.Write(obj.AuthenticatorData)
	h.Write(in.ClientDataHash[:])
	nonce := h.Sum(nil)
	digest := sha256.Sum256(nonce)
	if !ecdsa.VerifyASN1(in.PublicKey, digest[:], obj.Signature) {
		return 0, domain.ReasonSignatureInvalid
	}
	return authData.Counter, domain.ReasonNone
}
