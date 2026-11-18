package httpserver

import (
	"context"
	"errors"
	"log/slog"
	"net"
	"strings"
	"time"

	"connectrpc.com/connect/v2"
	"golang.org/x/time/rate"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/clientip"
	"github.com/aedst/server/internal/platform/observability"
)

// opaqueWarn lets one "opaque token" warning through per minute (rate.Sometimes: the first
// call runs, later ones only after the interval).
var (
	opaqueWarn = rate.Sometimes{Interval: time.Minute}
	idpWarn    = rate.Sometimes{Interval: time.Minute}
)

// Client-visible messages of the auth and limiter interceptors. A connect v2
// error message always goes to the wire, so these are fixed, generic texts.
const (
	msgNoCredential  = "missing bearer token"
	msgBadCredential = "invalid or expired token" //nolint:gosec // G101 false positive: a client-visible message, not a credential
	rateLimitMessage = "rate limit exceeded, try again later"
)

// callInfo is the per-call metadata connect v2 attaches to the handler context
// (request headers, peer address). Outside a connect.Server call, e.g. a bare
// interceptor test, it is an empty value rather than nil.
func callInfo(ctx context.Context) *connect.CallInfo {
	if info, ok := connect.CallInfoForServerContext(ctx); ok {
		return info
	}
	return &connect.CallInfo{}
}

// requestHeader is the inbound request's header set.
func requestHeader(ctx context.Context) *connect.Header {
	return callInfo(ctx).RequestHeader()
}

// AuthInterceptor verifies the bearer access token on every RPC except the
// procedures listed in publicProcedures (full name, e.g.
// "/aedst.capabilities.v1.CapabilitiesService/GetCapabilities"), placing the resulting Identity on the
// context via platform/auth.WithIdentity. This is the only place a bearer
// token is verified — modules never verify tokens themselves. verifier is
// the OIDC resource-server verifier. Applied per-RPC (not per-route) so a service can mix
// public and authenticated procedures. As a connect v2 ServerInterceptor it
// wraps every RPC type, streaming included.
func AuthInterceptor(verifier platformauth.Verifier, publicProcedures map[string]bool, logger *slog.Logger, opts ...AuthOption) connect.ServerInterceptor {
	cfg := authConfig{warn: failOpenWarner(logger)}
	for _, o := range opts {
		o(&cfg)
	}
	throttle := failureThrottle{cfg}
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			if publicProcedures[spec.Procedure] {
				return next(ctx, spec, stream)
			}

			if err := throttle.refuse(ctx); err != nil {
				return err
			}
			raw := bearerToken(requestHeader(ctx).Get("Authorization"))
			if raw == "" {
				throttle.record(ctx)
				return connect.NewError(connect.CodeUnauthenticated, msgNoCredential)
			}

			claims, err := verifier.VerifyAccessToken(ctx, raw)
			if err != nil {
				// The reason stays server-side; clients only learn "invalid".
				if errors.Is(err, platformauth.ErrOpaqueToken) {
					// A misconfigured IdP rejects every request: surface it at
					// warn level, at most once a minute.
					opaqueWarn.Do(func() {
						logger.WarnContext(ctx, "auth: opaque (non-JWT) access token rejected; configure the identity provider to issue JWT access tokens", slog.Any("error", err))
					})
				}
				if errors.Is(err, platformauth.ErrOIDCUnavailable) {
					// The identity provider cannot be reached (discovery or JWKS): this is
					// our dependency failing, not the caller's credential. Say so (retryable),
					// and do not charge it to the caller's failed-authentication budget.
					idpWarn.Do(func() {
						logger.WarnContext(ctx, "auth: identity provider unavailable (logged at most once per minute)", slog.Any("error", err))
					})
					return retryAfter(ctx, connect.NewError(connect.CodeUnavailable, "authentication temporarily unavailable").WithCause(err), retryAfterSeconds)
				}
				logger.DebugContext(ctx, "auth: token rejected", slog.Any("error", err))
				throttle.record(ctx)
				return connect.NewError(connect.CodeUnauthenticated, msgBadCredential)
			}

			ctx = platformauth.WithIdentity(ctx, platformauth.Identity{
				UserID:    claims.UserID,
				SessionID: claims.SessionID,
				DeviceID:  claims.DeviceID,
				Roles:     claims.Roles,
				Issuer:    claims.Issuer,
				Subject:   claims.Subject,
			})
			ctx = observability.WithUserID(ctx, claims.UserID.String())
			ctx = platformauth.WithBearer(ctx, raw)

			return next(ctx, spec, stream)
		}
	}
}

func bearerToken(header string) string {
	scheme, token, ok := strings.Cut(header, " ")
	if !ok || !strings.EqualFold(scheme, "Bearer") {
		return ""
	}
	return strings.TrimSpace(token)
}

// RateLimiter is satisfied by cache.RateLimiter.
type RateLimiter interface {
	Allow(ctx context.Context, key string, limit int, period time.Duration) (bool, error)
}

// RateLimitInterceptor throttles the listed procedures (typically the public
// authentication RPCs) per client address, cluster-wide via the shared
// limiter. It fails open on limiter errors (logged): rate limiting must not
// become a second way to take the API down.
func RateLimitInterceptor(limiter RateLimiter, procedures map[string]bool, perMinute int, logger *slog.Logger) connect.ServerInterceptor {
	warnFailOpen := failOpenWarner(logger)
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			procedure := spec.Procedure
			if !procedures[procedure] {
				return next(ctx, spec, stream)
			}

			key := "rl:" + procedure + ":" + clientAddr(ctx)
			allowed, err := limiter.Allow(ctx, key, perMinute, time.Minute)
			if err != nil {
				warnFailOpen(ctx, err)
			} else if !allowed {
				return connect.NewError(connect.CodeResourceExhausted, rateLimitMessage)
			}
			return next(ctx, spec, stream)
		}
	}
}

// clientAddr is the caller's address for rate limiting: the router's
// spoof-resistant client IP (set by the router), else the socket peer.
func clientAddr(ctx context.Context) string {
	if client := clientip.FromContext(ctx); client != "" {
		return client
	}
	return clientHost(callInfo(ctx).PeerAddr)
}

func clientHost(addr string) string {
	host, _, err := net.SplitHostPort(addr)
	if err != nil {
		return addr
	}
	return host
}

// UserRateLimitInterceptor throttles authenticated calls per user, cluster-wide
// through the shared limiter, so one runaway client or abusive account cannot
// exhaust capacity that belongs to everyone else. It must sit after
// AuthInterceptor; requests with no identity (the public procedures, which
// RateLimitInterceptor covers per client address) pass through. Like the
// per-address limiter it fails open: a limiter outage must not become an API
// outage.
func UserRateLimitInterceptor(limiter RateLimiter, perMinute int, logger *slog.Logger) connect.ServerInterceptor {
	warnFailOpen := failOpenWarner(logger)
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			identity, ok := platformauth.FromContext(ctx)
			if !ok {
				return next(ctx, spec, stream)
			}
			allowed, err := limiter.Allow(ctx, "rl:user:"+identity.UserID.String(), perMinute, time.Minute)
			if err != nil {
				warnFailOpen(ctx, err)
			} else if !allowed {
				return retryAfter(ctx, connect.NewError(connect.CodeResourceExhausted, rateLimitMessage), "1")
			}
			return next(ctx, spec, stream)
		}
	}
}

// RoleInterceptor enforces role-based access: policy maps a procedure's full
// name (e.g. "/aedst.admin.v1.AdminService/ListTasks") to the roles of which
// the caller must hold at least one. Procedures absent from policy need only
// authentication. It must sit after AuthInterceptor, which is what puts the
// caller's roles on the context; a listed procedure reached without an
// identity is rejected as unauthenticated rather than waved through.
func RoleInterceptor(policy map[string][]string) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			required, restricted := requiredRoles(policy, spec.Procedure)
			if !restricted {
				return next(ctx, spec, stream)
			}
			identity, ok := platformauth.FromContext(ctx)
			if !ok {
				return connect.NewError(connect.CodeUnauthenticated, msgNoCredential)
			}
			if !identity.HasAnyRole(required...) {
				return connect.NewError(connect.CodePermissionDenied, "insufficient role")
			}
			return next(ctx, spec, stream)
		}
	}
}

// failOpenWarnEvery bounds how often a limiter outage is logged.
const failOpenWarnEvery = 30 * time.Second

// failOpenWarner returns a logger for "the limiter is down, so requests are
// let through" that emits at most one line per failOpenWarnEvery. During a
// Dragonfly outage every request hits this path; one warning per request would
// bury the logs (and cost more than the outage itself) while adding nothing
// after the first.
func failOpenWarner(logger *slog.Logger) func(ctx context.Context, err error) {
	warn := rate.Sometimes{Interval: failOpenWarnEvery}
	return func(ctx context.Context, err error) {
		warn.Do(func() {
			logger.WarnContext(ctx, "rate limiter unavailable, failing open (logged at most once per 30s)", slog.Any("error", err))
		})
	}
}

// retryAfter sets the Retry-After response header (seconds) for an error an
// interceptor is about to return. connect v2 errors carry no metadata, so the
// hint travels on the call. Errors built far from the call (ToConnectError)
// use withRetryAfter plus ErrorHeadersInterceptor instead.
func retryAfter(ctx context.Context, e *connect.Error, seconds string) *connect.Error {
	callInfo(ctx).ResponseHeader().Set("Retry-After", seconds)
	return e
}
