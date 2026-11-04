// Package auth is the platform's authentication boundary. The server is a pure
// OpenID Connect resource server (ADR-0019): OIDCVerifier validates JWT access
// tokens issued by an external identity provider (JWKS discovery and caching,
// issuer and audience validation, no provider-specific code). The server
// issues no tokens and stores no credentials. No module implements token logic
// itself; the httpserver interceptor calls a Verifier.
package auth

import (
	"context"
	"errors"
	"strings"

	"github.com/lestrrat-go/jwx/v4/jwt"

	"github.com/aedst/server/internal/shared/ids"
)

// Verifier verifies a bearer access token and returns its claims. It is the
// only thing the httpserver interceptor knows about authentication.
type Verifier interface {
	VerifyAccessToken(ctx context.Context, raw string) (Claims, error)
}

var _ Verifier = (*OIDCVerifier)(nil)

// Claims is the verified, decoded form of an access token.
type Claims struct {
	Issuer    string
	Subject   string
	UserID    ids.ID
	SessionID ids.ID
	DeviceID  string
	Roles     []string
}

const claimSessionID = "sid"

// ErrOpaqueToken is returned for a bearer token that is not a JWT. This server
// verifies JWT access tokens offline (no introspection); an IdP issuing opaque
// (reference) tokens must be switched to JWT access tokens (ZITADEL: app
// accessTokenType OIDC_TOKEN_TYPE_JWT, machine user ACCESS_TOKEN_TYPE_JWT).
var ErrOpaqueToken = errors.New("auth: bearer token is not a JWT (opaque access token?): configure the identity provider to issue JWT access tokens")

// looksOpaque reports whether raw cannot be a compact JWS (three dot-separated
// segments), which is how opaque access tokens look.
func looksOpaque(raw string) bool { return strings.Count(raw, ".") != 2 }

// stringField reads a custom claim without relying on jwt.Get[T]'s exact type
// assertion (JSON-decoded claim values arrive as any).
func stringField(token jwt.Token, key string) string {
	v, ok := token.Field(key)
	if !ok {
		return ""
	}
	s, _ := v.(string)
	return s
}
