package auth

import (
	"context"
	"slices"
	"time"

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
	// Scopes are the OAuth scopes of the access token ("scope" / "scp" claims).
	// They say what the token may be used for; a machine caller (OIDC client
	// credentials) is usually authorised by scope, a person by role. Enforced
	// declaratively by the access policy (AEDST_ROLE_POLICY, "scope:<name>").
	Scopes []string
	// Issuer and Subject are the token's iss/sub as issued, for audit logs
	// and for linking to an external identity.
	Issuer  string
	Subject string
	// TenantID is the caller's tenant (organisation) id from the configured
	// tenant claim, empty in a single-tenant deployment. Repositories pass it to
	// tenancy.Apply so row-level security sees it (ADR-0024).
	TenantID string
	// ExpiresAt is when the access token expires (its "exp"). Only the realtime
	// gateway's GetConnectionAccess reads it; nothing may extend it.
	ExpiresAt time.Time
}

func (i Identity) HasRole(role string) bool {
	return slices.Contains(i.Roles, role)
}

// HasScope reports whether the token was granted scope.
func (i Identity) HasScope(scope string) bool {
	return slices.Contains(i.Scopes, scope)
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

type bearerKey struct{}

// WithBearer returns a context carrying the verified request's raw access token,
// so a call to another unit over the network (modulekit.NewClient) can forward
// it. It is set only by the auth interceptor, after verification. The token is a
// credential: never log it, and never read it for anything but forwarding.
func WithBearer(ctx context.Context, token string) context.Context {
	return context.WithValue(ctx, bearerKey{}, token)
}

// BearerFromContext returns the token set by WithBearer.
func BearerFromContext(ctx context.Context) (string, bool) {
	token, ok := ctx.Value(bearerKey{}).(string)
	return token, ok && token != ""
}

// HasAnyRole reports whether the identity holds at least one of roles.
func (i Identity) HasAnyRole(roles ...string) bool {
	return slices.ContainsFunc(roles, i.HasRole)
}
