package auth_test

import (
	"context"
	"slices"
	"testing"

	"github.com/lestrrat-go/jwx/v4/jwt"

	"github.com/aedst/server/internal/platform/auth"
)

// Scopes come from the verified token only: "scope" (RFC 9068, space-delimited)
// and "scp" (Okta, Entra: array or string), merged, sorted and de-duplicated.
func TestOIDCVerifier_ScopeClaimShapes(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)

	tests := []struct {
		name string
		set  func(*jwt.Builder)
		want []string
	}{
		{"scope string", func(b *jwt.Builder) { b.Claim("scope", "openid tasks.read  tasks.write") }, []string{"openid", "tasks.read", "tasks.write"}},
		{"scp array", func(b *jwt.Builder) { b.Claim("scp", []string{"tasks.write", "tasks.read"}) }, []string{"tasks.read", "tasks.write"}},
		{"scp string", func(b *jwt.Builder) { b.Claim("scp", "a b") }, []string{"a", "b"}},
		{"both claims are merged without duplicates", func(b *jwt.Builder) {
			b.Claim("scope", "a b").Claim("scp", []string{"b", "c d"})
		}, []string{"a", "b", "c", "d"}},
		{"no scope claim", func(*jwt.Builder) {}, nil},
		{"wrong shape grants nothing", func(b *jwt.Builder) { b.Claim("scope", map[string]any{"admin": true}).Claim("scp", 7) }, nil},
		{"non-string items are dropped", func(b *jwt.Builder) { b.Claim("scp", []any{"a", 1, nil, map[string]any{}}) }, []string{"a"}},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			claims, err := v.VerifyAccessToken(context.Background(), idp.token(t, tt.set))
			if err != nil {
				t.Fatalf("VerifyAccessToken() error = %v", err)
			}
			if !slices.Equal(claims.Scopes, tt.want) {
				t.Fatalf("scopes = %v, want %v", claims.Scopes, tt.want)
			}
		})
	}
}

func TestIdentity_HasScope(t *testing.T) {
	id := auth.Identity{Scopes: []string{"tasks.read"}}
	if !id.HasScope("tasks.read") || id.HasScope("tasks") || id.HasScope("") {
		t.Fatal("HasScope must match whole scope names only")
	}
}
