package httpserver

import (
	"context"
	"strconv"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"google.golang.org/genproto/googleapis/rpc/errdetails"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/durationpb"

	sharederrors "github.com/aedst/server/internal/shared/errors"
)

// ErrorDomain is the ErrorInfo.domain of every error this server produces.
const ErrorDomain = "aedst"

// Default ErrorInfo.reason per error kind. A domain error may carry a more
// specific one (sharederrors.Error.WithReason, e.g. STALE_VERSION); clients
// switch on the reason, never on the message text.
const (
	ReasonNotFound           = "NOT_FOUND"
	ReasonAlreadyExists      = "ALREADY_EXISTS"
	ReasonConflict           = "CONFLICT"
	ReasonInvalidArgument    = "INVALID_ARGUMENT"
	ReasonUnauthenticated    = "UNAUTHENTICATED"
	ReasonPermissionDenied   = "PERMISSION_DENIED"
	ReasonRateLimited        = "RATE_LIMITED"
	ReasonFailedPrecondition = "FAILED_PRECONDITION"
	ReasonUnavailable        = "UNAVAILABLE"
	ReasonTimeout            = "TIMEOUT"
	// ReasonInsufficientScope: the token lacks an OAuth scope the procedure requires.
	ReasonInsufficientScope = "INSUFFICIENT_SCOPE"
)

// withDetails attaches the google.rpc detail messages to e. A message that
// cannot be packed is skipped: the code and message still describe the error.
func withDetails(e *connect.Error, details ...proto.Message) *connect.Error {
	for _, d := range details {
		if detail, err := connectproto.NewErrorDetail(d); err == nil {
			e = e.WithDetail(detail)
		}
	}
	return e
}

// errorInfo is the google.rpc.ErrorInfo every classified error carries.
func errorInfo(reason string, metadata map[string]string) *errdetails.ErrorInfo {
	return &errdetails.ErrorInfo{Reason: reason, Domain: ErrorDomain, Metadata: metadata}
}

// retryInfo is the google.rpc.RetryInfo twin of the Retry-After header.
func retryInfo(seconds string) *errdetails.RetryInfo {
	n, err := strconv.Atoi(seconds)
	if err != nil || n < 0 {
		n = 0
	}
	return &errdetails.RetryInfo{RetryDelay: durationpb.New(time.Duration(n) * time.Second)}
}

// preconditionFailure describes why the system state refused the operation
// (a stale expected_version, a reused idempotency key, a feature not enabled).
func preconditionFailure(reason, description string) *errdetails.PreconditionFailure {
	return &errdetails.PreconditionFailure{Violations: []*errdetails.PreconditionFailure_Violation{
		{Type: reason, Description: description},
	}}
}

// reasonOf is the domain error's own reason, or fallback.
func reasonOf(err error, fallback string) string {
	if reason := sharederrors.ReasonOf(err); reason != "" {
		return reason
	}
	return fallback
}

// rateLimited is the one RESOURCE_EXHAUSTED answer of the limiters: ErrorInfo
// RATE_LIMITED, RetryInfo and the Retry-After response header (seconds).
func rateLimited(ctx context.Context, message, seconds string) *connect.Error {
	e := withDetails(connect.NewError(connect.CodeResourceExhausted, message), errorInfo(ReasonRateLimited, nil), retryInfo(seconds))
	return retryAfter(ctx, e, seconds)
}

// permissionDenied is PERMISSION_DENIED with a machine-readable reason.
func permissionDenied(message, reason string, metadata map[string]string) *connect.Error {
	return withDetails(connect.NewError(connect.CodePermissionDenied, message), errorInfo(reason, metadata))
}
