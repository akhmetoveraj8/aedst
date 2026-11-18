package auth_test

import (
	"context"
	"testing"
)

// BenchmarkVerifyAccessToken is the per-request cost of authentication (JWS
// signature, header gate, claims); also a PGO profile source (scripts/pgo.sh).
func BenchmarkVerifyAccessToken(b *testing.B) {
	idp := newFakeIdP(b)
	v := newVerifier(b, idp)
	raw := idp.token(b, nil)
	ctx := context.Background()
	if _, err := v.VerifyAccessToken(ctx, raw); err != nil {
		b.Fatal(err)
	}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := v.VerifyAccessToken(ctx, raw); err != nil {
			b.Fatal(err)
		}
	}
}
