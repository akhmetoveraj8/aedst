package domain_test

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"crypto/sha256"
	"encoding/base64"
	"encoding/binary"
	"strings"
	"testing"

	"github.com/aedst/server/internal/modules/appattest/domain"
)

func TestClientData_IsTheDocumentedConvention(t *testing.T) {
	got := string(domain.ClientData("login", []byte("n1")))
	if got != "aedst.appattest.v1\nlogin\nn1" {
		t.Fatalf("client data = %q", got)
	}
	want := sha256.Sum256([]byte(got))
	if domain.ClientDataHash("login", []byte("n1")) != want {
		t.Error("client data hash is not SHA-256 of the client data")
	}
	if domain.ClientDataHash("login", []byte("n2")) == domain.ClientDataHash("login", []byte("n1")) {
		t.Error("payload must be bound")
	}
	if domain.ClientDataHash("pay", []byte("n1")) == domain.ClientDataHash("login", []byte("n1")) {
		t.Error("action must be bound")
	}
}

func TestValidAction(t *testing.T) {
	for _, ok := range []string{"login", "a", "purchase.v2", "a-b_c", strings.Repeat("a", 64)} {
		if !domain.ValidAction(ok) {
			t.Errorf("%q should be valid", ok)
		}
	}
	for _, bad := range []string{"", "Login", "1login", "a b", "a\nb", strings.Repeat("a", 65)} {
		if domain.ValidAction(bad) {
			t.Errorf("%q should be invalid", bad)
		}
	}
}

func TestPolicy(t *testing.T) {
	p := domain.Policy{TeamID: "ABCDE12345", AllowedBundleIDs: []string{"com.example.app"}}
	if err := p.Validate(); err != nil {
		t.Fatal(err)
	}
	for name, bad := range map[string]domain.Policy{
		"short team id": {TeamID: "ABC", AllowedBundleIDs: []string{"a.b"}},
		"lower team id": {TeamID: "abcde12345", AllowedBundleIDs: []string{"a.b"}},
		"no bundles":    {TeamID: "ABCDE12345"},
		"bad bundle":    {TeamID: "ABCDE12345", AllowedBundleIDs: []string{"a b"}},
	} {
		if bad.Validate() == nil {
			t.Errorf("%s should be invalid", name)
		}
	}
	if got := p.AppID("com.example.app"); got != "ABCDE12345.com.example.app" {
		t.Errorf("AppID = %q", got)
	}
	if b, ok := p.ResolveBundle(""); !ok || b != "com.example.app" {
		t.Errorf("empty resolves to the only bundle: %q %v", b, ok)
	}
	if _, ok := p.ResolveBundle("com.other"); ok {
		t.Error("unlisted bundle accepted")
	}
	p.AllowedBundleIDs = append(p.AllowedBundleIDs, "com.example.beta")
	if _, ok := p.ResolveBundle(""); ok {
		t.Error("empty must be ambiguous with several bundles")
	}
	if p.EnvironmentAllowed(domain.EnvironmentDevelopment) || !p.EnvironmentAllowed(domain.EnvironmentProduction) {
		t.Error("development must be off by default")
	}
	p.AllowDevelopment = true
	if !p.EnvironmentAllowed(domain.EnvironmentDevelopment) {
		t.Error("development should be allowed when switched on")
	}
}

func TestKeyID_RoundTrip(t *testing.T) {
	priv, _ := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	id, err := domain.KeyIDOf(&priv.PublicKey)
	if err != nil || len(id) != 32 {
		t.Fatal(err)
	}
	point := append([]byte{0x04}, append(priv.X.FillBytes(make([]byte, 32)), priv.Y.FillBytes(make([]byte, 32))...)...)
	if want := sha256.Sum256(point); string(id) != string(want[:]) {
		t.Error("key id is not SHA-256 of the uncompressed X9.62 point")
	}
	back, err := domain.DecodeKeyID(base64.StdEncoding.EncodeToString(id))
	if err != nil || string(back) != string(id) {
		t.Errorf("round trip = %x %v", back, err)
	}
	// 32 bytes encode to 43 characters + "="; the last character carries two padding bits that
	// must be zero. Setting one is a second spelling of the same key id and must be refused.
	const alphabet = "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/"
	canonical := base64.StdEncoding.EncodeToString(id)
	alt := []byte(canonical)
	alt[42] = alphabet[strings.IndexByte(alphabet, canonical[42])|1]
	if _, err := domain.DecodeKeyID(string(alt)); err == nil {
		t.Errorf("non-canonical spelling %q of %q accepted", alt, canonical)
	}
	for _, bad := range []string{"", "AAAA", base64.StdEncoding.EncodeToString([]byte("short")), base64.RawURLEncoding.EncodeToString(id) + "!"} {
		if _, err := domain.DecodeKeyID(bad); err == nil {
			t.Errorf("%q accepted", bad)
		}
	}
}

func authData(counter uint32, flags byte, aaguid [16]byte, credID []byte) []byte {
	rp := domain.RPIDHash("T.b")
	out := append([]byte{}, rp[:]...)
	out = append(out, flags)
	out = binary.BigEndian.AppendUint32(out, counter)
	out = append(out, aaguid[:]...)
	out = binary.BigEndian.AppendUint16(out, uint16(len(credID)))
	return append(out, credID...)
}

func TestParseAuthData(t *testing.T) {
	prod := [16]byte{'a', 'p', 'p', 'a', 't', 't', 'e', 's', 't'}
	id := []byte{1, 2, 3}
	ad, err := domain.ParseAttestationAuthData(authData(0, 0x40, prod, id))
	if err != nil || ad.Counter != 0 || string(ad.CredentialID) != string(id) || !ad.HasCredential {
		t.Fatalf("= %+v %v", ad, err)
	}
	for name, b := range map[string][]byte{
		"empty":                nil,
		"short":                make([]byte, 36),
		"no attested flag":     authData(0, 0x01, prod, id),
		"truncated credential": authData(0, 0x40, prod, id)[:len(authData(0, 0x40, prod, id))-1],
		"zero length id":       authData(0, 0x40, prod, nil),
		"no aaguid":            authData(0, 0x40, prod, id)[:40],
	} {
		if _, err := domain.ParseAttestationAuthData(b); err == nil {
			t.Errorf("%s accepted", name)
		}
	}
	short, err := domain.ParseAssertionAuthData(authData(7, 0, prod, id)[:37])
	if err != nil || short.Counter != 7 {
		t.Errorf("assertion auth data = %+v %v", short, err)
	}
	if _, err := domain.ParseAssertionAuthData(make([]byte, 36)); err == nil {
		t.Error("36 bytes accepted")
	}
}

func TestJudgeAttestation(t *testing.T) {
	prod := [16]byte{'a', 'p', 'p', 'a', 't', 't', 'e', 's', 't'}
	dev := [16]byte{'a', 'p', 'p', 'a', 't', 't', 'e', 's', 't', 'd', 'e', 'v', 'e', 'l', 'o', 'p'}
	id := make([]byte, 32)
	parse := func(counter uint32, aaguid [16]byte, cred []byte) domain.AuthData {
		ad, err := domain.ParseAttestationAuthData(authData(counter, 0x40, aaguid, cred))
		if err != nil {
			t.Fatal(err)
		}
		return ad
	}
	if env, r := domain.JudgeAttestation(parse(0, prod, id), "T.b", id); r != domain.ReasonNone || env != domain.EnvironmentProduction {
		t.Errorf("production = %q %q", env, r)
	}
	if env, r := domain.JudgeAttestation(parse(0, dev, id), "T.b", id); r != domain.ReasonNone || env != domain.EnvironmentDevelopment {
		t.Errorf("development = %q %q", env, r)
	}
	if _, r := domain.JudgeAttestation(parse(0, prod, id), "T.other", id); r != domain.ReasonAppIDMismatch {
		t.Errorf("app id = %q", r)
	}
	if _, r := domain.JudgeAttestation(parse(2, prod, id), "T.b", id); r != domain.ReasonCounterNotZero {
		t.Errorf("counter = %q", r)
	}
	if _, r := domain.JudgeAttestation(parse(0, [16]byte{'x'}, id), "T.b", id); r != domain.ReasonAAGUIDInvalid {
		t.Errorf("aaguid = %q", r)
	}
	// The sandbox aaguid some libraries accept is not Apple's documented value.
	if _, r := domain.JudgeAttestation(parse(0, [16]byte{'a', 'p', 'p', 'a', 't', 't', 'e', 's', 't', 's', 'a', 'n', 'd', 'b', 'o', 'x'}, id), "T.b", id); r != domain.ReasonAAGUIDInvalid {
		t.Errorf("appattestsandbox = %q", r)
	}
	if _, r := domain.JudgeAttestation(parse(0, prod, []byte{9}), "T.b", id); r != domain.ReasonKeyIDMismatch {
		t.Errorf("credential id = %q", r)
	}
}

func TestDecodeKeyID_RejectsEmbeddedNewlines(t *testing.T) {
	// base64's decoder skips CR/LF: without the canonical-spelling check these
	// would all name the same key id.
	for _, s := range []string{"AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA\n=", "AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA=\r\n"} {
		if _, err := domain.DecodeKeyID(s); err == nil {
			t.Errorf("DecodeKeyID(%q) accepted a non-canonical spelling", s)
		}
	}
}
