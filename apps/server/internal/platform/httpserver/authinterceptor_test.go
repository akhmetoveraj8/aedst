package httpserver_test

import (
	"context"
	"errors"
	"net/http/httptest"
	"testing"

	"connectrpc.com/connect/v2"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/shared/ids"
)

type stubVerifier struct {
	claims platformauth.Claims
	err    error
	seen   string
}

func (s *stubVerifier) VerifyAccessToken(_ context.Context, raw string) (platformauth.Claims, error) {
	s.seen = raw
	return s.claims, s.err
}

// callWith sends one request with the given Authorization header through
// AuthInterceptor and reports the identity the handler saw.
func callWith(t *testing.T, verifier platformauth.Verifier, public map[string]bool, authorization string) (platformauth.Identity, bool, error) {
	t.Helper()
	var (
		identity platformauth.Identity
		ok       bool
	)
	srv := httptest.NewServer(newHandler(testProcedure,
		func(ctx context.Context) error {
			identity, ok = platformauth.FromContext(ctx)
			return nil
		}, httpserver.AuthInterceptor(verifier, public, discardLogger())))
	t.Cleanup(srv.Close)

	var opts []callOption
	if authorization != "" {
		opts = append(opts, requestHeader("Authorization", authorization))
	}
	err := callUnary(srv, testProcedure, opts...)
	return identity, ok, err
}

func TestAuthInterceptor(t *testing.T) {
	user := ids.New()
	good := &stubVerifier{claims: platformauth.Claims{UserID: user, SessionID: ids.New(), DeviceID: "d", Roles: []string{"user"}, Issuer: "iss", Subject: "sub"}}

	t.Run("a valid bearer token puts the verified identity on the context", func(t *testing.T) {
		identity, ok, err := callWith(t, good, nil, "Bearer the-token")
		if err != nil || !ok || identity.UserID != user || identity.DeviceID != "d" || !identity.HasRole("user") || identity.Issuer != "iss" {
			t.Fatalf("identity = %+v (ok %v), err %v", identity, ok, err)
		}
		if good.seen != "the-token" {
			t.Errorf("verifier saw %q, want the bare token", good.seen)
		}
	})
	t.Run("the scheme is case-insensitive", func(t *testing.T) {
		if _, ok, err := callWith(t, good, nil, "bEaReR the-token"); err != nil || !ok {
			t.Fatalf("lowercase scheme rejected: %v", err)
		}
	})
	for name, header := range map[string]string{"no header": "", "wrong scheme": "Basic dXNlcjpwdw==", "scheme only": "Bearer", "empty token": "Bearer  "} {
		t.Run("rejects "+name, func(t *testing.T) {
			if _, ok, err := callWith(t, good, nil, header); connect.CodeOf(err) != connect.CodeUnauthenticated || ok {
				t.Fatalf("err = %v, handler reached = %v; want Unauthenticated before the handler", err, ok)
			}
		})
	}
	t.Run("an invalid token is rejected without saying why", func(t *testing.T) {
		bad := &stubVerifier{err: errors.New("signature mismatch for kid abc")}
		_, ok, err := callWith(t, bad, nil, "Bearer forged")
		if connect.CodeOf(err) != connect.CodeUnauthenticated || ok {
			t.Fatalf("err = %v, handler reached = %v", err, ok)
		}
		if got := err.Error(); got != "unauthenticated: invalid or expired token" {
			t.Errorf("error = %q, want a generic message (the reason stays in server logs)", got)
		}
	})
	t.Run("public procedures need no token and get no identity", func(t *testing.T) {
		_, ok, err := callWith(t, &stubVerifier{err: errors.New("must not be called")}, map[string]bool{testProcedure: true}, "")
		if err != nil || ok {
			t.Fatalf("public call = %v, identity present %v; want success without an identity", err, ok)
		}
	})
}
