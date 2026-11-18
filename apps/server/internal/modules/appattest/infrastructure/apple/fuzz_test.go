package apple

import (
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"testing"

	"github.com/aedst/server/internal/modules/appattest/appattesttest"
	"github.com/aedst/server/internal/modules/appattest/domain"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

const fuzzAppID = "ABCDE12345.com.example.aedst"

// Attacker-controlled bytes reach the CBOR decoder, the authenticator-data
// parser, x509 and the ASN.1 nonce extension. None may panic, and a rejection
// must not leak a half-built result.

func FuzzVerifyAttestation(f *testing.F) {
	pki := appattesttest.NewPKI(f)
	dev := pki.NewDevice(f)
	v := NewVerifier(pki.Roots, sharedtime.Fixed{At: appattesttest.Now})
	challenge := sha256.Sum256([]byte("challenge"))
	valid := dev.Attest(f, appattesttest.AttestOpts{AppID: fuzzAppID, Challenge: challenge[:]})
	f.Add(valid, dev.KeyID)
	f.Add(valid[:len(valid)/2], dev.KeyID)
	f.Add([]byte{0xa3, 0x63, 'f', 'm', 't'}, []byte{})
	f.Add([]byte{0xbf, 0xff}, []byte{}) // indefinite-length map: forbidden
	f.Fuzz(func(t *testing.T, object, keyID []byte) {
		got, reason := v.VerifyAttestation(domain.AttestationInput{
			Object: object, ClientDataHash: challenge[:], KeyID: keyID, AppID: fuzzAppID,
		})
		if reason != domain.ReasonNone && got.PublicKey != nil {
			t.Fatalf("rejected (%s) but returned a key", reason)
		}
		if reason == domain.ReasonNone && got.PublicKey == nil {
			t.Fatal("accepted without a public key")
		}
	})
}

func FuzzVerifyAssertion(f *testing.F) {
	pki := appattesttest.NewPKI(f)
	dev := pki.NewDevice(f)
	v := NewVerifier(pki.Roots, sharedtime.Fixed{At: appattesttest.Now})
	valid := dev.Assert(f, fuzzAppID, 1, "login", []byte("payload"))
	f.Add(valid)
	f.Add(valid[:len(valid)-1])
	f.Add([]byte{0xa2, 0x69, 's', 'i', 'g', 'n', 'a', 't', 'u', 'r', 'e', 0x40})
	f.Fuzz(func(t *testing.T, object []byte) {
		counter, reason := v.VerifyAssertion(domain.AssertionInput{
			Object: object, ClientDataHash: sha256.Sum256([]byte("x")), PublicKey: &dev.Key.PublicKey, AppID: fuzzAppID,
		})
		if reason != domain.ReasonNone && counter != 0 {
			t.Fatalf("rejected (%s) but returned counter %d", reason, counter)
		}
	})
}

// FuzzNonceFromCertificate drives the DER walk of the nonce extension directly.
func FuzzNonceFromCertificate(f *testing.F) {
	f.Add([]byte{0x30, 0x24, 0xa1, 0x22, 0x04, 0x20, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18, 19, 20, 21, 22, 23, 24, 25, 26, 27, 28, 29, 30, 31, 32})
	f.Add([]byte{0x30, 0x80, 0x00, 0x00}) // BER indefinite length
	f.Add([]byte{0x30, 0x03, 0xa1, 0x01})
	f.Fuzz(func(t *testing.T, value []byte) {
		cert := &x509.Certificate{Extensions: []pkix.Extension{{Id: nonceOID, Value: value}}}
		nonce, err := nonceFromCertificate(cert)
		if err == nil && len(nonce) > len(value) {
			t.Fatalf("nonce (%d bytes) longer than its extension (%d bytes)", len(nonce), len(value))
		}
	})
}
