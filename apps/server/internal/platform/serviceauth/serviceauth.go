// Package serviceauth is the machine identity of the server: an OIDC
// client-credentials client (golang.org/x/oauth2/clientcredentials) that gives a
// call with no user behind it (a River job such as admin.apply) a bearer token
// for another unit's operator service. The receiving unit verifies it like any
// other access token (ADR-0020 section 5); the identity provider decides its
// roles, so the "internal" role is granted there, never in code.
//
// The token is cached and refreshed by the oauth2 library; every caller shares
// one token source per process.
package serviceauth

import (
	"context"
	"errors"
	"fmt"
	"net/http"

	"golang.org/x/oauth2"
	"golang.org/x/oauth2/clientcredentials"

	"github.com/aedst/server/internal/platform/config"
)

// TokenSource returns a bearer token for a call that has no operator behind it.
// It has the shape modules use (admin/infrastructure/remote.TokenSource).
type TokenSource func(ctx context.Context) (string, error)

// New builds the token source for cfg. It returns nil when no service identity is
// configured, so a caller can tell "not configured" from "failed". client may be
// nil (http.DefaultClient); tests pass a client that talks to a fake provider.
func New(ctx context.Context, cfg config.ServiceIdentityConfig, client *http.Client) TokenSource {
	if !cfg.Enabled() {
		return nil
	}
	cc := clientcredentials.Config{
		ClientID:     cfg.ClientID,
		ClientSecret: cfg.ClientSecret,
		TokenURL:     cfg.TokenURL,
		Scopes:       cfg.Scopes,
		AuthStyle:    oauth2.AuthStyleInHeader,
	}
	// One long-lived source: oauth2.ReuseTokenSource caches until shortly before
	// expiry and serialises refreshes. It carries the HTTP client and keeps ctx's
	// values but not its cancellation: River drains running jobs after the signal
	// context ends, and a job finishing then still needs a token.
	base := context.WithoutCancel(ctx)
	if client != nil {
		base = context.WithValue(base, oauth2.HTTPClient, client)
	}
	src := oauth2.ReuseTokenSource(nil, cc.TokenSource(base))
	return func(ctx context.Context) (string, error) {
		if err := ctx.Err(); err != nil {
			return "", fmt.Errorf("serviceauth: %w", err)
		}
		tok, err := src.Token()
		if err != nil {
			return "", fmt.Errorf("serviceauth: token: %w", err)
		}
		if tok.AccessToken == "" {
			return "", errors.New("serviceauth: provider returned an empty access token")
		}
		return tok.AccessToken, nil
	}
}
