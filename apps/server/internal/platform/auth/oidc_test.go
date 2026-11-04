package auth_test

import (
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/json"
	"errors"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v4/jwa"
	"github.com/lestrrat-go/jwx/v4/jwk"
	"github.com/lestrrat-go/jwx/v4/jws"
	"github.com/lestrrat-go/jwx/v4/jwt"

	"github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/shared/ids"
)

const testAudience = "aedst-api"

type fakeIdP struct {
	server  *httptest.Server
	signer  jwk.Key
	mu      sync.Mutex
	set     jwk.Set
	fetches int
}

func (i *fakeIdP) jwksFetches() int {
	i.mu.Lock()
	defer i.mu.Unlock()
	return i.fetches
}

// rotate replaces the provider's signing key with a new one under kid and
// publishes only the new public key.
func (i *fakeIdP) rotate(t *testing.T, kid string) {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jwk.Import[jwk.Key](priv)
	if err != nil {
		t.Fatal(err)
	}
	_ = signer.Set(jwk.KeyIDKey, kid)
	pub, err := jwk.PublicKeyOf(signer)
	if err != nil {
		t.Fatal(err)
	}
	_ = pub.Set(jwk.AlgorithmKey, jwa.ES256())
	set := jwk.NewSet()
	_ = set.AddKey(pub)
	i.mu.Lock()
	i.signer, i.set = signer, set
	i.mu.Unlock()
}

func newFakeIdP(t *testing.T) *fakeIdP {
	t.Helper()

	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	signer, err := jwk.Import[jwk.Key](priv)
	if err != nil {
		t.Fatal(err)
	}
	_ = signer.Set(jwk.KeyIDKey, "k1")
	pub, err := jwk.PublicKeyOf(signer)
	if err != nil {
		t.Fatal(err)
	}
	_ = pub.Set(jwk.AlgorithmKey, jwa.ES256())
	set := jwk.NewSet()
	_ = set.AddKey(pub)

	idp := &fakeIdP{signer: signer, set: set}
	mux := http.NewServeMux()
	idp.server = httptest.NewServer(mux)
	t.Cleanup(idp.server.Close)

	mux.HandleFunc("/.well-known/openid-configuration", func(w http.ResponseWriter, _ *http.Request) {
		_ = json.NewEncoder(w).Encode(map[string]string{"issuer": idp.server.URL, "jwks_uri": idp.server.URL + "/jwks"})
	})
	mux.HandleFunc("/jwks", func(w http.ResponseWriter, _ *http.Request) {
		idp.mu.Lock()
		idp.fetches++
		current := idp.set
		idp.mu.Unlock()
		_ = json.NewEncoder(w).Encode(current)
	})
	return idp
}

func (i *fakeIdP) token(t *testing.T, mutate func(*jwt.Builder)) string {
	t.Helper()
	return i.tokenTyped(t, "at+jwt", mutate)
}

// tokenTyped signs a token with the given JOSE typ header ("" = none).
func (i *fakeIdP) tokenTyped(t *testing.T, typ string, mutate func(*jwt.Builder)) string {
	t.Helper()
	now := time.Now()
	b := jwt.NewBuilder().
		Issuer(i.server.URL).
		Subject("user-123").
		Audience([]string{testAudience}).
		IssuedAt(now).
		Expiration(now.Add(time.Hour)).
		Claim("roles", []string{"admin"})
	if mutate != nil {
		mutate(b)
	}
	tok, err := b.Build()
	if err != nil {
		t.Fatal(err)
	}
	if typ == "" { // jwt.Sign always adds typ=JWT: sign the payload as a bare JWS to omit it
		payload, err := json.Marshal(tok)
		if err != nil {
			t.Fatal(err)
		}
		i.mu.Lock()
		signer := i.signer
		i.mu.Unlock()
		signed, err := jws.Sign(payload, jws.WithKey(jwa.ES256(), signer))
		if err != nil {
			t.Fatal(err)
		}
		return string(signed)
	}
	var signOpts []jwt.Option
	if typ != "" {
		headers := jws.NewHeaders()
		_ = headers.Set(jws.TypeKey, typ)
		signOpts = append(signOpts, jws.WithProtectedHeaders(headers))
	}
	i.mu.Lock()
	signer := i.signer
	i.mu.Unlock()
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.ES256(), signer, signOpts...))
	if err != nil {
		t.Fatal(err)
	}
	return string(signed)
}

func newVerifier(t *testing.T, idp *fakeIdP) *auth.OIDCVerifier {
	t.Helper()
	v, err := auth.NewOIDCVerifier(auth.OIDCConfig{
		Issuer:     idp.server.URL,
		Audience:   testAudience,
		Algorithms: []string{"ES256"},
		RolesClaim: "roles",
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = v.Close(context.Background()) })
	return v
}

func TestOIDCVerifier_AcceptsValidToken(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)

	claims, err := v.VerifyAccessToken(context.Background(), idp.token(t, nil))
	if err != nil {
		t.Fatalf("VerifyAccessToken() error = %v", err)
	}
	if claims.Subject != "user-123" || claims.UserID != ids.FromExternal(idp.server.URL, "user-123") {
		t.Errorf("claims = %+v, want subject user-123 mapped via ids.FromExternal", claims)
	}
	if len(claims.Roles) != 1 || claims.Roles[0] != "admin" {
		t.Errorf("roles = %v, want [admin]", claims.Roles)
	}
}

func TestOIDCVerifier_RejectsWrongAudienceIssuerAndExpiry(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)

	cases := map[string]func(*jwt.Builder){
		"wrong audience": func(b *jwt.Builder) { b.Audience([]string{"someone-else"}) },
		"wrong issuer":   func(b *jwt.Builder) { b.Issuer("https://evil.example") },
		"expired":        func(b *jwt.Builder) { b.Expiration(time.Now().Add(-time.Hour)) },
	}
	for name, mutate := range cases {
		if _, err := v.VerifyAccessToken(context.Background(), idp.token(t, mutate)); err == nil {
			t.Errorf("%s: VerifyAccessToken() accepted an invalid token", name)
		}
	}
}

func TestOIDCVerifier_RejectsDisallowedAlgorithm(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)

	// An HS256 token "signed" with a public-key-shaped secret is the classic
	// algorithm-confusion attack; it must never reach signature verification.
	hmacKey, err := jwk.Import[jwk.Key]([]byte("0123456789abcdef0123456789abcdef"))
	if err != nil {
		t.Fatal(err)
	}
	tok, _ := jwt.NewBuilder().Issuer(idp.server.URL).Subject("x").Audience([]string{testAudience}).Expiration(time.Now().Add(time.Hour)).Build()
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.HS256(), hmacKey))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.VerifyAccessToken(context.Background(), string(signed)); err == nil {
		t.Fatal("VerifyAccessToken() accepted an HS256 token for an asymmetric-only issuer")
	}
}

func TestOIDCVerifier_UnreachableProviderFailsClosed(t *testing.T) {
	idp := newFakeIdP(t)
	token := idp.token(t, nil)
	v := newVerifier(t, idp)
	idp.server.Close()

	if _, err := v.VerifyAccessToken(context.Background(), token); err == nil {
		t.Fatal("VerifyAccessToken() succeeded while the provider was unreachable")
	}
}

func TestOIDCVerifier_RejectsUnknownIssuer(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)
	if _, err := v.VerifyAccessToken(context.Background(), idp.token(t, nil)); err != nil {
		t.Errorf("oidc token rejected: %v", err)
	}
	if _, err := v.VerifyAccessToken(context.Background(), idp.token(t, func(b *jwt.Builder) { b.Issuer("https://unknown.example") })); err == nil {
		t.Error("token from an unknown issuer was accepted")
	}
}

func TestIDsFromExternal_UUIDSubjectPassesThroughOthersAreStable(t *testing.T) {
	u := ids.New()
	if got := ids.FromExternal("iss", u.String()); got != u {
		t.Errorf("UUID subject mapped to %s, want %s", got, u)
	}
	a, b := ids.FromExternal("iss", "12345"), ids.FromExternal("iss", "12345")
	if a != b || a == ids.FromExternal("other-iss", "12345") {
		t.Error("non-UUID subject mapping must be deterministic and issuer-scoped")
	}
}

func TestOIDCVerifier_RolesClaimShapes(t *testing.T) {
	idp := newFakeIdP(t)

	tests := []struct {
		name      string
		claim     string
		set       func(*jwt.Builder)
		wantRoles []string
	}{
		{"keycloak dotted path", "realm_access.roles", func(b *jwt.Builder) {
			b.Claim("realm_access", map[string]any{"roles": []string{"user", "admin"}})
		}, []string{"user", "admin"}},
		{"zitadel object keyed by role", "urn:zitadel:iam:org:project:roles", func(b *jwt.Builder) {
			b.Claim("urn:zitadel:iam:org:project:roles", map[string]any{"editor": map[string]any{"org": "x"}, "admin": map[string]any{}})
		}, []string{"admin", "editor"}},
		{"claim name containing dots wins over path splitting", "https://example.com/roles", func(b *jwt.Builder) {
			b.Claim("https://example.com/roles", []string{"a"})
		}, []string{"a"}},
		{"space separated string", "scope", func(b *jwt.Builder) { b.Claim("scope", "read write") }, []string{"read", "write"}},
		{"missing claim", "nope.nothing", func(*jwt.Builder) {}, nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, err := auth.NewOIDCVerifier(auth.OIDCConfig{
				Issuer: idp.server.URL, Audience: testAudience, Algorithms: []string{"ES256"}, RolesClaim: tt.claim,
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = v.Close(context.Background()) })

			claims, err := v.VerifyAccessToken(context.Background(), idp.token(t, tt.set))
			if err != nil {
				t.Fatalf("VerifyAccessToken() error = %v", err)
			}
			if len(claims.Roles) != len(tt.wantRoles) {
				t.Fatalf("roles = %v, want %v", claims.Roles, tt.wantRoles)
			}
			for i := range tt.wantRoles {
				if claims.Roles[i] != tt.wantRoles[i] {
					t.Fatalf("roles = %v, want %v", claims.Roles, tt.wantRoles)
				}
			}
		})
	}
}

func TestOIDCVerifier_RolesOrgFilter(t *testing.T) {
	idp := newFakeIdP(t)
	const claim = "urn:zitadel:iam:org:project:roles"
	zitadelRoles := func(b *jwt.Builder) {
		b.Claim(claim, map[string]any{
			"admin":  map[string]any{"org-a": "a.example"},
			"user":   map[string]any{"org-a": "a.example", "org-b": "b.example"},
			"editor": map[string]any{"org-b": "b.example"},
			"bare":   true, // no organisation info
		})
	}

	tests := []struct {
		name  string
		org   string
		claim string
		set   func(*jwt.Builder)
		want  []string
	}{
		{"empty org keeps every role", "", claim, zitadelRoles, []string{"admin", "bare", "editor", "user"}},
		{"org-a only", "org-a", claim, zitadelRoles, []string{"admin", "user"}},
		{"org-b only", "org-b", claim, zitadelRoles, []string{"editor", "user"}},
		{"org mismatch yields no roles", "org-c", claim, zitadelRoles, nil},
		{"org is ignored for array claims", "org-a", "roles", func(b *jwt.Builder) { b.Claim("roles", []string{"admin"}) }, []string{"admin"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, err := auth.NewOIDCVerifier(auth.OIDCConfig{
				Issuer: idp.server.URL, Audience: testAudience, Algorithms: []string{"ES256"},
				RolesClaim: tt.claim, RolesOrg: tt.org,
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = v.Close(context.Background()) })

			claims, err := v.VerifyAccessToken(context.Background(), idp.token(t, tt.set))
			if err != nil {
				t.Fatalf("VerifyAccessToken() error = %v", err)
			}
			if !slices.Equal(claims.Roles, tt.want) {
				t.Fatalf("roles = %v, want %v", claims.Roles, tt.want)
			}
		})
	}
}

func TestOIDCVerifier_OpaqueTokenGivesActionableError(t *testing.T) {
	idp := newFakeIdP(t)
	oidc := newVerifier(t, idp)
	// An opaque access token (what an IdP issues when the app is not set to JWT).
	const opaque = "Kj3nFZ0xq9aVbYtL2hQeW8uRmP4sDcGoXiN7vAzTyBwE1lHk"
	_, err := oidc.VerifyAccessToken(context.Background(), opaque)
	if !errors.Is(err, auth.ErrOpaqueToken) {
		t.Errorf("err = %v, want ErrOpaqueToken", err)
	}
	if err != nil && !strings.Contains(err.Error(), "JWT access tokens") {
		t.Errorf("error lacks the JWT hint: %v", err)
	}
}

// A ZITADEL access token (JWT access-token type): numeric subject, the project
// id (and the client id) in aud, roles as an object keyed by role name with the
// granting organisations below each role.
func TestOIDCVerifier_ZitadelShapedToken(t *testing.T) {
	idp := newFakeIdP(t)
	const projectID = "312345678901234567"
	const rolesClaim = "urn:zitadel:iam:org:project:roles"
	v, err := auth.NewOIDCVerifier(auth.OIDCConfig{
		Issuer: idp.server.URL, Audience: projectID, Algorithms: []string{"ES256"}, RolesClaim: rolesClaim,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = v.Close(context.Background()) })

	raw := idp.token(t, func(b *jwt.Builder) {
		b.Subject("312345678901234999").
			Audience([]string{"312345678901234888", projectID}).
			Claim(rolesClaim, map[string]any{
				"admin": map[string]any{"312345678901230000": "aedst.localhost"},
				"user":  map[string]any{"312345678901230000": "aedst.localhost"},
			})
	})
	claims, err := v.VerifyAccessToken(context.Background(), raw)
	if err != nil {
		t.Fatalf("VerifyAccessToken() error = %v", err)
	}
	if want := ids.FromExternal(idp.server.URL, "312345678901234999"); claims.UserID != want {
		t.Errorf("UserID = %s, want deterministic mapping %s", claims.UserID, want)
	}
	if len(claims.Roles) != 2 || claims.Roles[0] != "admin" || claims.Roles[1] != "user" {
		t.Errorf("roles = %v, want [admin user]", claims.Roles)
	}

	// A token for a different project (audience) is rejected.
	other := idp.token(t, func(b *jwt.Builder) { b.Audience([]string{"999"}) })
	if _, err := v.VerifyAccessToken(context.Background(), other); err == nil {
		t.Error("token with another project as audience must be rejected")
	}
}
