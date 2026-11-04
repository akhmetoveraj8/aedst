// Package authtest is an in-process OpenID Connect provider for integration
// tests: discovery, JWKS and a token minter. The server is a pure OIDC resource
// server (ADR-0019), so every test that calls an authenticated RPC signs in with
// a token minted here. It lives under internal/platform/auth because only that
// tree may import the JOSE library.
package authtest

import (
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"net/http"
	"net/http/httptest"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v4/jwa"
	"github.com/lestrrat-go/jwx/v4/jwk"
	"github.com/lestrrat-go/jwx/v4/jwt"
)

// Audience is the AEDST_OIDC_AUDIENCE test servers are started with.
const Audience = "aedst-test-api"

// IdP is a running test identity provider.
type IdP struct {
	// URL is the issuer (AEDST_OIDC_ISSUER).
	URL    string
	server *httptest.Server
	signer jwk.Key
}

// New starts a provider that is shut down when t ends. Use a package-level
// instance (and Close it in TestMain) to share one across a test binary.
func New(t testing.TB) *IdP {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jwk.Import[jwk.Key](priv)
	if err != nil {
		t.Fatal(err)
	}
	_ = signer.Set(jwk.KeyIDKey, "it-1")
	pub, err := jwk.PublicKeyOf(signer)
	if err != nil {
		t.Fatal(err)
	}
	_ = pub.Set(jwk.AlgorithmKey, jwa.ES256())
	set := jwk.NewSet()
	_ = set.AddKey(pub)

	p := &IdP{signer: signer}
	mux := http.NewServeMux()
	p.server = httptest.NewServer(mux)
	p.URL = p.server.URL
	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"issuer": p.URL, "jwks_uri": p.URL + "/jwks"})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) { _ = json.NewEncoder(w).Encode(set) })
	return p
}

// Close stops the provider.
func (p *IdP) Close() { p.server.Close() }

// Token signs an access token for subject carrying roles.
func (p *IdP) Token(t testing.TB, subject string, roles ...string) string {
	t.Helper()
	now := time.Now()
	tok, err := jwt.NewBuilder().
		Issuer(p.URL).
		Subject(subject).
		Audience([]string{Audience}).
		IssuedAt(now).
		Expiration(now.Add(time.Hour)).
		Claim("roles", roles).
		Build()
	if err != nil {
		t.Fatal(err)
	}
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.ES256(), p.signer))
	if err != nil {
		t.Fatal(err)
	}
	return string(signed)
}
