package auth_test

import (
	"context"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"
	"time"

	"github.com/lestrrat-go/jwx/v4/jwa"
	"github.com/lestrrat-go/jwx/v4/jwt"

	"github.com/aedst/server/internal/platform/auth"
)

// within fails the test when f does not return in d: a regression here is a
// hang (a lookup blocked on a dead cache backend), not an error.
func within[T any](t *testing.T, d time.Duration, f func() T) T {
	t.Helper()
	done := make(chan T, 1)
	go func() { done <- f() }()
	select {
	case v := <-done:
		return v
	case <-time.After(d):
		t.Fatalf("call did not return within %s", d)
		var zero T
		return zero
	}
}

// The JWKS cache must outlive the request that first needed it: httprc ties its
// backend to the context it starts on, so a cache started on a request context
// dies with that request and every later lookup blocks forever.
func TestOIDCVerifier_KeepsWorkingAfterTheFirstRequestContextEnds(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)

	reqCtx, cancel := context.WithCancel(context.Background())
	if _, err := v.VerifyAccessToken(reqCtx, idp.token(t, nil)); err != nil {
		t.Fatalf("first VerifyAccessToken() error = %v", err)
	}
	cancel()                           // the first request ends
	time.Sleep(100 * time.Millisecond) // let a context-bound backend notice and exit

	for i := range 3 {
		err := within(t, 5*time.Second, func() error {
			ctx, cancel := context.WithTimeout(context.Background(), 3*time.Second)
			defer cancel()
			_, err := v.VerifyAccessToken(ctx, idp.token(t, nil))
			return err
		})
		if err != nil {
			t.Fatalf("VerifyAccessToken() #%d after the first request ended: %v", i+2, err)
		}
	}
}

// Discovery and the first JWKS fetch are not done under the verifier's mutex:
// while they hang (an IdP outage), concurrent callers give up when their own
// context ends instead of queueing behind the fetch, and they share one attempt.
func TestOIDCVerifier_ConcurrentCallersDoNotQueueBehindASlowProvider(t *testing.T) {
	idp := newFakeIdP(t)
	release := make(chan struct{})
	var jwksRequests atomic.Int32
	slow := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		jwksRequests.Add(1)
		select {
		case <-release:
		case <-r.Context().Done():
			return
		}
		resp, err := http.Get(idp.server.URL + "/jwks")
		if err != nil {
			http.Error(w, err.Error(), http.StatusBadGateway)
			return
		}
		defer func() { _ = resp.Body.Close() }()
		_, _ = io.Copy(w, resp.Body)
	}))
	t.Cleanup(slow.Close)

	v, err := auth.NewOIDCVerifier(auth.OIDCConfig{
		Issuer: idp.server.URL, Audience: testAudience, Algorithms: []string{"ES256"}, JWKSURL: slow.URL,
	})
	if err != nil {
		t.Fatal(err)
	}
	t.Cleanup(func() { _ = v.Close(context.Background()) })

	warmed := make(chan error, 1)
	go func() { warmed <- v.Warm(context.Background()) }()
	token := idp.token(t, nil)
	for range 5 {
		err := within(t, 2*time.Second, func() error {
			ctx, cancel := context.WithTimeout(context.Background(), 100*time.Millisecond)
			defer cancel()
			_, err := v.VerifyAccessToken(ctx, token)
			return err
		})
		if !errors.Is(err, auth.ErrOIDCUnavailable) {
			t.Fatalf("err = %v, want ErrOIDCUnavailable while the first fetch is in flight", err)
		}
	}

	close(release)
	if err := within(t, 5*time.Second, func() error { return <-warmed }); err != nil {
		t.Fatalf("Warm() error = %v", err)
	}
	if _, err := v.VerifyAccessToken(context.Background(), token); err != nil {
		t.Fatalf("VerifyAccessToken() after warm-up: %v", err)
	}
	if n := jwksRequests.Load(); n != 1 {
		t.Errorf("JWKS fetched %d times during init, want 1 shared attempt", n)
	}
}

// jwx validates exp only when the claim is present; a token without one would
// be valid forever, so the verifier requires it.
func TestOIDCVerifier_RejectsTokenWithoutExpiry(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)

	tok, err := jwt.NewBuilder().Issuer(idp.server.URL).Subject("user-123").
		Audience([]string{testAudience}).IssuedAt(time.Now()).Build()
	if err != nil {
		t.Fatal(err)
	}
	idp.mu.Lock()
	signer := idp.signer
	idp.mu.Unlock()
	signed, err := jwt.Sign(tok, jwt.WithKey(jwa.ES256(), signer))
	if err != nil {
		t.Fatal(err)
	}
	if _, err := v.VerifyAccessToken(context.Background(), string(signed)); err == nil {
		t.Fatal("VerifyAccessToken() accepted a token without exp")
	}
}

func TestOIDCVerifier_ClosedVerifierFailsClosed(t *testing.T) {
	idp := newFakeIdP(t)
	v := newVerifier(t, idp)
	if err := v.Warm(context.Background()); err != nil {
		t.Fatalf("Warm() error = %v", err)
	}
	if err := v.Close(context.Background()); err != nil {
		t.Fatalf("Close() error = %v", err)
	}
	err := within(t, 2*time.Second, func() error {
		_, err := v.VerifyAccessToken(context.Background(), idp.token(t, nil))
		return err
	})
	if !errors.Is(err, auth.ErrOIDCUnavailable) {
		t.Fatalf("err = %v, want ErrOIDCUnavailable after Close", err)
	}
}
