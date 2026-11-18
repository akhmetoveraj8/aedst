package modulekit

import (
	"context"
	"errors"
	"net/http"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"go.opentelemetry.io/contrib/instrumentation/net/http/otelhttp"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/resilience"
	sharederrors "github.com/aedst/server/internal/shared/errors"
)

// RemoteTarget is where a unit that this process does not host lives. It is
// handed to the unit's Module.Remote hook.
type RemoteTarget struct {
	// Name is the unit name ("tasks", "social/like").
	Name string
	// BaseURL is AEDST_MODULE_<NAME>_URL.
	BaseURL string
	// HTTPClient overrides the default client (tests, a custom mesh transport).
	HTTPClient connecthttp.HTTPClient
}

// Defaults for a call to another unit: it is an in-datacenter hop, so the
// deadline is short and the breaker trips on transport failures only.
const (
	remoteTimeout     = 5 * time.Second
	remoteMaxRequests = 3
	remoteRateLimit   = 1000
)

// NewClient builds the Connect client a Module.Remote hook wraps its api/
// adapter around. The transport has a deadline, a circuit breaker and a rate
// limit (platform/resilience), is traced (otelhttp: the W3C traceparent
// continues the caller's trace) and forwards the caller's bearer token, so the
// remote unit authenticates the same user the same way the monolith does.
func NewClient(t RemoteTarget) *connect.Client {
	httpClient := t.HTTPClient
	if httpClient == nil {
		rt := resilience.WrapRoundTripper(otelhttp.NewTransport(&http.Transport{Proxy: http.ProxyFromEnvironment, ForceAttemptHTTP2: true, MaxIdleConnsPerHost: 32, IdleConnTimeout: 90 * time.Second}), resilience.Config{
			BreakerName: "module-" + t.Name, Timeout: remoteTimeout, MaxRequests: remoteMaxRequests, RateLimitRPS: remoteRateLimit,
		})
		httpClient = &http.Client{Transport: rt}
	}
	return connect.NewClient(connecthttp.NewTransport(httpClient, t.BaseURL, connecthttp.WithProtoJSON()), forwardBearer)
}

// forwardBearer copies the inbound request's access token onto the outbound
// call. A call with no token (a background job) is sent without one and the
// remote unit answers UNAUTHENTICATED: service-to-service identity for work
// that has no user is a separate decision (ADR-0020), never an implicit default.
func forwardBearer(next connect.ClientFunc) connect.ClientFunc {
	return func(ctx context.Context, spec connect.Spec) (connect.ClientStream, error) {
		if token, ok := platformauth.BearerFromContext(ctx); ok {
			if info, ok := connect.CallInfoForClientContext(ctx); ok {
				info.RequestHeader().Set("Authorization", "Bearer "+token)
			}
		}
		return next(ctx, spec)
	}
}

// ErrorFromConnect maps an error returned by a remote unit to the kinds the
// rest of the code already understands, so a caller handles "not found" the
// same way whether the unit is in this process or not (the inverse of
// httpserver.ToConnectError). Transport failures become Unavailable.
//
//nolint:wrapcheck // every branch returns a classified sharederrors value
func ErrorFromConnect(op string, err error) error {
	if err == nil {
		return nil
	}
	var ce *connect.Error
	if !errors.As(err, &ce) {
		return sharederrors.Wrap(op, err)
	}
	msg := ce.Message()
	switch ce.Code() {
	case connect.CodeNotFound:
		return sharederrors.NotFound(op, msg)
	case connect.CodeAlreadyExists:
		return sharederrors.AlreadyExists(op, msg)
	case connect.CodeAborted:
		return sharederrors.Conflict(op, msg)
	case connect.CodeInvalidArgument:
		return sharederrors.Validation(op, msg)
	case connect.CodeUnauthenticated:
		return sharederrors.Unauthorized(op, msg)
	case connect.CodePermissionDenied:
		return sharederrors.Forbidden(op, msg)
	case connect.CodeResourceExhausted:
		return sharederrors.RateLimited(op, msg)
	case connect.CodeFailedPrecondition:
		return sharederrors.FailedPrecondition(op, msg)
	case connect.CodeUnavailable:
		return &sharederrors.Error{Kind: sharederrors.KindUnavailable, Op: op, Message: "service temporarily unavailable", Err: err}
	case connect.CodeDeadlineExceeded:
		return &sharederrors.Error{Kind: sharederrors.KindTimeout, Op: op, Message: "the operation timed out", Err: err}
	default:
		return sharederrors.Wrap(op, err)
	}
}
