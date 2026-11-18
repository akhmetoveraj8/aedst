package serviceauth_test

import (
	"net/http"
	"net/http/httptest"
	"sync/atomic"
	"testing"

	"github.com/aedst/server/internal/platform/config"
	"github.com/aedst/server/internal/platform/serviceauth"
)

func TestNewIsNilWhenNotConfigured(t *testing.T) {
	if serviceauth.New(t.Context(), config.ServiceIdentityConfig{}, nil) != nil {
		t.Fatal("an unconfigured identity must be nil so callers refuse up front")
	}
}

func TestTokenIsFetchedWithClientCredentialsAndCached(t *testing.T) {
	var calls atomic.Int32
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		calls.Add(1)
		id, secret, ok := r.BasicAuth()
		if !ok || id != "svc" || secret != "s3cret" {
			http.Error(w, "bad client", http.StatusUnauthorized)
			return
		}
		if err := r.ParseForm(); err != nil || r.PostForm.Get("grant_type") != "client_credentials" || r.PostForm.Get("scope") != "openid roles" {
			http.Error(w, "bad grant", http.StatusBadRequest)
			return
		}
		w.Header().Set("Content-Type", "application/json")
		_, _ = w.Write([]byte(`{"access_token":"tok-1","token_type":"Bearer","expires_in":3600}`))
	}))
	t.Cleanup(srv.Close)

	token := serviceauth.New(t.Context(), config.ServiceIdentityConfig{
		TokenURL: srv.URL, ClientID: "svc", ClientSecret: "s3cret", Scopes: []string{"openid", "roles"},
	}, srv.Client())
	if token == nil {
		t.Fatal("expected a token source")
	}
	for range 3 {
		got, err := token(t.Context())
		if err != nil || got != "tok-1" {
			t.Fatalf("token = %q, %v", got, err)
		}
	}
	if calls.Load() != 1 {
		t.Fatalf("provider called %d times, want 1 (the token must be cached)", calls.Load())
	}
}

func TestProviderFailureIsAnError(t *testing.T) {
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, _ *http.Request) {
		http.Error(w, `{"error":"invalid_client"}`, http.StatusUnauthorized)
	}))
	t.Cleanup(srv.Close)
	token := serviceauth.New(t.Context(), config.ServiceIdentityConfig{TokenURL: srv.URL, ClientID: "x", ClientSecret: "y"}, srv.Client())
	if _, err := token(t.Context()); err == nil {
		t.Fatal("a provider rejection must surface as an error, never an empty token")
	}
}
