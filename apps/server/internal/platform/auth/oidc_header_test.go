package auth_test

import (
	"context"
	"testing"

	"github.com/lestrrat-go/jwx/v4/jwt"

	"github.com/aedst/server/internal/platform/auth"
)

func TestOIDCVerifier_TokenTypeHeader(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)
	ctx := context.Background()

	for _, typ := range []string{"at+jwt", "AT+JWT", "application/at+jwt", "JWT"} {
		if _, err := v.VerifyAccessToken(ctx, idp.tokenTyped(t, typ, nil)); err != nil {
			t.Errorf("typ %q rejected: %v", typ, err)
		}
	}
	for _, typ := range []string{"", "id_token+jwt", "logout+jwt", "JOSE"} {
		if _, err := v.VerifyAccessToken(ctx, idp.tokenTyped(t, typ, nil)); err == nil {
			t.Errorf("typ %q accepted: only access-token types may pass", typ)
		}
	}
}

func TestOIDCVerifier_TokenTypesAreConfigurable(t *testing.T) {
	idp := newFakeIdP(t)
	v, err := auth.NewOIDCVerifier(auth.OIDCConfig{
		Issuer: idp.server.URL, Audience: testAudience, Algorithms: []string{"ES256"}, RolesClaim: "roles",
		TokenTypes: []string{"at+jwt"},
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = v.Close(context.Background()) })
	if _, err := v.VerifyAccessToken(context.Background(), idp.tokenTyped(t, "JWT", nil)); err == nil {
		t.Fatal("JWT accepted although only at+jwt is allowed")
	}
	if _, err := v.VerifyAccessToken(context.Background(), idp.tokenTyped(t, "at+jwt", nil)); err != nil {
		t.Fatalf("at+jwt rejected: %v", err)
	}
}

// An ID token validly signed by the provider, even with the API's project as an
// audience (ZITADEL adds it on request) and a plain "JWT" typ, is not an access
// token and must be refused (RFC 9068 §4).
func TestOIDCVerifier_RejectsIDTokensWithTheProjectAudience(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)
	cases := map[string]func(*jwt.Builder){
		"nonce":            func(b *jwt.Builder) { b.Claim("nonce", "abc") },
		"at_hash":          func(b *jwt.Builder) { b.Claim("at_hash", "xyz") },
		"c_hash":           func(b *jwt.Builder) { b.Claim("c_hash", "xyz") },
		"keycloak ID typ":  func(b *jwt.Builder) { b.Claim("typ", "ID") },
		"keycloak refresh": func(b *jwt.Builder) { b.Claim("typ", "Refresh") },
	}
	for name, mutate := range cases {
		if _, err := v.VerifyAccessToken(context.Background(), idp.tokenTyped(t, "JWT", mutate)); err == nil {
			t.Errorf("%s: an ID/refresh token was accepted as an access token", name)
		}
	}
	// Keycloak's access token says typ=Bearer in the payload: accepted.
	if _, err := v.VerifyAccessToken(context.Background(), idp.tokenTyped(t, "JWT", func(b *jwt.Builder) { b.Claim("typ", "Bearer") })); err != nil {
		t.Errorf("Keycloak-shaped access token rejected: %v", err)
	}
}

// The provider rotates its signing key: a token signed by the new key (unknown kid)
// triggers one forced JWKS refresh and then verifies; a second unknown kid inside the
// rate-limit window does not trigger another fetch.
func TestOIDCVerifier_KeyRotation(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)
	ctx := context.Background()
	if _, err := v.VerifyAccessToken(ctx, idp.token(t, nil)); err != nil {
		t.Fatalf("before rotation: %v", err)
	}
	fetchesBefore := idp.jwksFetches()

	idp.rotate(t, "k2")
	if _, err := v.VerifyAccessToken(ctx, idp.token(t, nil)); err != nil {
		t.Fatalf("after rotation the new key must be picked up by a forced refresh: %v", err)
	}
	if got := idp.jwksFetches() - fetchesBefore; got != 1 {
		t.Fatalf("rotation cost %d JWKS fetches, want exactly 1", got)
	}

	// Garbage with unknown kids does not become a fetch per request.
	idp.rotate(t, "k3")
	for range 5 {
		_, _ = v.VerifyAccessToken(ctx, idp.token(t, nil))
	}
	if got := idp.jwksFetches() - fetchesBefore; got > 1 {
		t.Fatalf("%d fetches: unknown kids inside the rate-limit window must not refetch", got)
	}
}

func TestOIDCVerifier_KnownKeyBadSignatureDoesNotRefetch(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)
	ctx := context.Background()
	if _, err := v.VerifyAccessToken(ctx, idp.token(t, nil)); err != nil {
		t.Fatal(err)
	}
	before := idp.jwksFetches()
	_, err := v.VerifyAccessToken(ctx, idp.token(t, func(b *jwt.Builder) { b.Audience([]string{"someone-else"}) }))
	if err == nil {
		t.Fatal("wrong audience accepted")
	}
	if idp.jwksFetches() != before {
		t.Fatal("a failure unrelated to key rotation caused a JWKS fetch")
	}
}
