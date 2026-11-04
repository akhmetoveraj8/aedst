// Package appattesttest builds a synthetic Apple-like App Attest PKI and
// devices for tests: a root CA, an intermediate CA, and credential
// certificates carrying the attestation nonce, plus attestation and assertion
// objects exactly as the App Attest service encodes them. Nothing here is
// used by production code.
package appattesttest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"crypto/x509"
	"crypto/x509/pkix"
	"encoding/asn1"
	"encoding/base64"
	"encoding/binary"
	"math/big"
	"testing"
	"time"

	"github.com/fxamacker/cbor/v2"

	"github.com/aedst/server/internal/modules/appattest/domain"
)

// Now is the fixed instant the synthetic certificates are valid around.
var Now = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

// AAGUIDs as Apple documents them.
var (
	AAGUIDProduction  = [16]byte{'a', 'p', 'p', 'a', 't', 't', 'e', 's', 't'}
	AAGUIDDevelopment = [16]byte{'a', 'p', 'p', 'a', 't', 't', 'e', 's', 't', 'd', 'e', 'v', 'e', 'l', 'o', 'p'}
)

// NonceOID is the credential certificate extension carrying the nonce.
var NonceOID = asn1.ObjectIdentifier{1, 2, 840, 113635, 100, 8, 2}

// PKI is a root and an intermediate CA.
type PKI struct {
	Roots   *x509.CertPool
	rootKey *ecdsa.PrivateKey
	intKey  *ecdsa.PrivateKey
	intCert *x509.Certificate
	rootDER []byte
	intDER  []byte
}

func serial(t testing.TB) *big.Int {
	t.Helper()
	n, err := rand.Int(rand.Reader, new(big.Int).Lsh(big.NewInt(1), 100))
	if err != nil {
		t.Fatal(err)
	}
	return n
}

func check(t testing.TB, err error) {
	t.Helper()
	if err != nil {
		t.Fatal(err)
	}
}

// NewPKI creates a fresh root (P-384, like Apple's) and intermediate.
func NewPKI(t testing.TB) *PKI {
	t.Helper()
	rootKey, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	check(t, err)
	rootTmpl := &x509.Certificate{
		SerialNumber: serial(t), Subject: pkix.Name{CommonName: "Test App Attestation Root CA"},
		NotBefore: Now.Add(-24 * time.Hour * 365), NotAfter: Now.Add(24 * time.Hour * 365),
		IsCA: true, BasicConstraintsValid: true, KeyUsage: x509.KeyUsageCertSign,
	}
	rootDER, err := x509.CreateCertificate(rand.Reader, rootTmpl, rootTmpl, &rootKey.PublicKey, rootKey)
	check(t, err)
	rootCert, err := x509.ParseCertificate(rootDER)
	check(t, err)

	intKey, err := ecdsa.GenerateKey(elliptic.P384(), rand.Reader)
	check(t, err)
	intTmpl := &x509.Certificate{
		SerialNumber: serial(t), Subject: pkix.Name{CommonName: "Test App Attestation CA 1"},
		NotBefore: Now.Add(-24 * time.Hour * 30), NotAfter: Now.Add(24 * time.Hour * 30),
		IsCA: true, BasicConstraintsValid: true, MaxPathLen: 0, MaxPathLenZero: true, KeyUsage: x509.KeyUsageCertSign,
	}
	intDER, err := x509.CreateCertificate(rand.Reader, intTmpl, rootCert, &intKey.PublicKey, rootKey)
	check(t, err)
	intCert, err := x509.ParseCertificate(intDER)
	check(t, err)

	pool := x509.NewCertPool()
	pool.AddCert(rootCert)
	return &PKI{Roots: pool, rootKey: rootKey, intKey: intKey, intCert: intCert, rootDER: rootDER, intDER: intDER}
}

// Device is one app install's attested key.
type Device struct {
	Key         *ecdsa.PrivateKey
	KeyID       []byte
	KeyIDString string
	PKI         *PKI
}

// NewDevice generates an App Attest key (P-256) whose credential certificates
// the PKI will sign.
func (p *PKI) NewDevice(t testing.TB) *Device {
	t.Helper()
	key, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	check(t, err)
	keyID, err := domain.KeyIDOf(&key.PublicKey)
	check(t, err)
	return &Device{Key: key, KeyID: keyID, KeyIDString: base64.StdEncoding.EncodeToString(keyID), PKI: p}
}

// AttestOpts describes an attestation; zero values mean "a valid production attestation".
type AttestOpts struct {
	AppID     string
	Challenge []byte
	Counter   uint32
	AAGUID    [16]byte // zero = production
	// CredentialID overrides the credentialId in authData (default: the key id).
	CredentialID []byte
	// Flags overrides the authData flags (zero = 0x40, attested credential data present).
	Flags byte
	// Nonce overrides the nonce put in the certificate (default: the correct one).
	Nonce []byte
	// SignWith signs the chain with another PKI instead of the device's.
	SignWith *PKI
	// Format overrides fmt (default "apple-appattest").
	Format string
	// OnlyLeaf drops the intermediate from x5c (one certificate chain).
	OnlyLeaf bool
	// NotBefore/NotAfter override the credential certificate validity.
	NotBefore, NotAfter time.Time
	// OmitNonceExtension builds a credential certificate without the extension.
	OmitNonceExtension bool
	// RawNonceExtension replaces the extension value entirely.
	RawNonceExtension []byte
	// LeafKey replaces the key in the credential certificate (default: the device key).
	LeafKey *ecdsa.PublicKey
}

// AuthData builds attestation authenticator data.
func AuthData(appID string, counter uint32, aaguid [16]byte, credentialID []byte, flags byte, pub *ecdsa.PublicKey) []byte {
	if flags == 0 {
		flags = 0x40
	}
	if aaguid == ([16]byte{}) {
		aaguid = AAGUIDProduction
	}
	rp := domain.RPIDHash(appID)
	out := append([]byte{}, rp[:]...)
	out = append(out, flags)
	out = binary.BigEndian.AppendUint32(out, counter)
	out = append(out, aaguid[:]...)
	out = binary.BigEndian.AppendUint16(out, uint16(len(credentialID)))
	out = append(out, credentialID...)
	point, _ := pub.Bytes()
	cose := map[int]any{1: 2, 3: -7, -1: 1, -2: point[1:33], -3: point[33:65]}
	enc, _ := cbor.Marshal(cose)
	return append(out, enc...)
}

func nonceExtension(nonce []byte) []byte {
	octet, _ := asn1.Marshal(nonce)
	tagged, _ := asn1.Marshal(asn1.RawValue{Class: asn1.ClassContextSpecific, Tag: 1, IsCompound: true, Bytes: octet})
	seq, _ := asn1.Marshal(asn1.RawValue{Class: asn1.ClassUniversal, Tag: asn1.TagSequence, IsCompound: true, Bytes: tagged})
	return seq
}

// Attest produces an attestation object.
func (d *Device) Attest(t testing.TB, o AttestOpts) []byte {
	t.Helper()
	credID := o.CredentialID
	if credID == nil {
		credID = d.KeyID
	}
	authData := AuthData(o.AppID, o.Counter, o.AAGUID, credID, o.Flags, &d.Key.PublicKey)

	clientDataHash := sha256.Sum256(o.Challenge)
	nonceHash := sha256.Sum256(append(append([]byte{}, authData...), clientDataHash[:]...))
	nonce := nonceHash[:]
	if o.Nonce != nil {
		nonce = o.Nonce
	}

	pki := d.PKI
	if o.SignWith != nil {
		pki = o.SignWith
	}
	notBefore, notAfter := o.NotBefore, o.NotAfter
	if notBefore.IsZero() {
		notBefore = Now.Add(-time.Hour)
	}
	if notAfter.IsZero() {
		notAfter = Now.Add(72 * time.Hour)
	}
	leafKey := &d.Key.PublicKey
	if o.LeafKey != nil {
		leafKey = o.LeafKey
	}
	tmpl := &x509.Certificate{
		SerialNumber: serial(t), Subject: pkix.Name{CommonName: "attested key", Organization: []string{"Test"}},
		NotBefore: notBefore, NotAfter: notAfter,
		KeyUsage:           x509.KeyUsageDigitalSignature,
		UnknownExtKeyUsage: []asn1.ObjectIdentifier{{1, 2, 840, 113635, 100, 4, 6}},
	}
	switch {
	case o.RawNonceExtension != nil:
		tmpl.ExtraExtensions = []pkix.Extension{{Id: NonceOID, Value: o.RawNonceExtension}}
	case !o.OmitNonceExtension:
		tmpl.ExtraExtensions = []pkix.Extension{{Id: NonceOID, Value: nonceExtension(nonce)}}
	}
	leafDER, err := x509.CreateCertificate(rand.Reader, tmpl, pki.intCert, leafKey, pki.intKey)
	check(t, err)

	x5c := [][]byte{leafDER, pki.intDER}
	if o.OnlyLeaf {
		x5c = x5c[:1]
	}
	format := o.Format
	if format == "" {
		format = "apple-appattest"
	}
	obj := map[string]any{
		"fmt":      format,
		"attStmt":  map[string]any{"x5c": x5c, "receipt": []byte("receipt")},
		"authData": authData,
	}
	out, err := cbor.Marshal(obj)
	check(t, err)
	return out
}

// AssertionAuthData builds the short authenticator data of an assertion.
func AssertionAuthData(appID string, counter uint32) []byte {
	rp := domain.RPIDHash(appID)
	out := append([]byte{}, rp[:]...)
	out = append(out, 0x00)
	return binary.BigEndian.AppendUint32(out, counter)
}

// Assert produces an assertion object for action/payload with the given counter.
func (d *Device) Assert(t testing.TB, appID string, counter uint32, action string, payload []byte) []byte {
	t.Helper()
	return d.AssertWith(t, d.Key, appID, counter, domain.ClientDataHash(action, payload))
}

// AssertWith signs an arbitrary clientDataHash with the given key.
func (d *Device) AssertWith(t testing.TB, key *ecdsa.PrivateKey, appID string, counter uint32, clientDataHash [32]byte) []byte {
	t.Helper()
	authData := AssertionAuthData(appID, counter)
	nonce := sha256.Sum256(append(append([]byte{}, authData...), clientDataHash[:]...))
	digest := sha256.Sum256(nonce[:])
	sig, err := ecdsa.SignASN1(rand.Reader, key, digest[:])
	check(t, err)
	out, err := cbor.Marshal(map[string]any{"signature": sig, "authenticatorData": authData})
	check(t, err)
	return out
}
