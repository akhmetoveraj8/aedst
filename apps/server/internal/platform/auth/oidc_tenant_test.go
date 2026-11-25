package auth_test

import (
	"context"
	"errors"
	"testing"

	"github.com/lestrrat-go/jwx/v4/jwt"

	"github.com/aedst/server/internal/platform/auth"
)

// The tenant claim becomes Claims.TenantID (ADR-0024); with TenantRequired a token
// without it is rejected, and without a configured claim the tenant stays empty.
func TestOIDCVerifier_TenantClaim(t *testing.T) {
	idp := newFakeIdP(t)
	const claim = "urn:zitadel:iam:user:resourceowner:id"
	withTenant := func(b *jwt.Builder) { b.Claim(claim, "org-42") }
	noTenant := func(*jwt.Builder) {}

	tests := []struct {
		name     string
		claim    string
		required bool
		set      func(*jwt.Builder)
		want     string
		wantErr  error
	}{
		{"claim configured and present", claim, false, withTenant, "org-42", nil},
		{"claim configured, absent, optional", claim, false, noTenant, "", nil},
		{"claim configured, absent, required", claim, true, noTenant, "", auth.ErrMissingTenant},
		{"no claim configured", "", false, withTenant, "", nil},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			v, err := auth.NewOIDCVerifier(auth.OIDCConfig{
				Issuer: idp.server.URL, Audience: testAudience, Algorithms: []string{"ES256"},
				RolesClaim: "roles", TenantClaim: tt.claim, TenantRequired: tt.required,
			})
			if err != nil {
				t.Fatal(err)
			}
			t.Cleanup(func() { _ = v.Close(context.Background()) })

			claims, err := v.VerifyAccessToken(context.Background(), idp.token(t, tt.set))
			if tt.wantErr != nil {
				if !errors.Is(err, tt.wantErr) {
					t.Fatalf("err = %v, want %v", err, tt.wantErr)
				}
				return
			}
			if err != nil {
				t.Fatalf("VerifyAccessToken() error = %v", err)
			}
			if claims.TenantID != tt.want {
				t.Fatalf("TenantID = %q, want %q", claims.TenantID, tt.want)
			}
		})
	}
}
