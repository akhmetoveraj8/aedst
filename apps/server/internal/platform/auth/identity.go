package auth

import (
	"context"

	"github.com/aedst/server/internal/shared/ids"
)

// Identity is the authenticated principal, extracted from a verified access
// token by the httpserver auth interceptor and placed on the context. Modules
// consume it via FromContext — they never verify tokens themselves (see
// docs/content/server/architecture.md).
type Identity struct {
	// UserID is the stable owner id modules key their data by. For an
	// external OIDC token it is derived from (Issuer, Subject) via
	// ids.FromExternal.
	UserID    ids.ID
	SessionID ids.ID
	DeviceID  string
	Roles     []string
	// Issuer and Subject are the token's iss/sub as issued, for audit logs
	// and for linking to an external identity.
	Issuer  string
	Subject string
}

func (i Identity) HasRole(role string) bool {
	for _, r := range i.Roles {
		if r == role {
			return true
		}
	}
	return false
}

type identityKey struct{}

// WithIdentity returns a context carrying the authenticated identity.
func WithIdentity(ctx context.Context, id Identity) context.Context {
	return context.WithValue(ctx, identityKey{}, id)
}

// FromContext returns the authenticated identity, if any request-scoped
// context carries one.
func FromContext(ctx context.Context) (Identity, bool) {
	id, ok := ctx.Value(identityKey{}).(Identity)
	return id, ok
}

// HasAnyRole reports whether the identity holds at least one of roles.
func (i Identity) HasAnyRole(roles ...string) bool {
	for _, role := range roles {
		if i.HasRole(role) {
			return true
		}
	}
	return false
}
