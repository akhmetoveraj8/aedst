package httpserver

import (
	"context"
	"errors"
	"log/slog"

	"connectrpc.com/connect/v2"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/trace"

	sharederrors "github.com/aedst/server/internal/shared/errors"
)

// Messages for failures whose detail must never reach a client.
const (
	internalMessage = "internal error"
	unclassifiedMsg = "request failed"
)

// serverCause is the local-only cause attached to a *connect.Error (connect v2
// never serializes it). It carries the real server-side failure for
// ErrorLogInterceptor and, optionally, a Retry-After hint that
// ErrorHeadersInterceptor turns into a response header: a v2 error has no
// metadata of its own, headers travel on the call's CallInfo.
type serverCause struct {
	cause      error
	retryAfter string // seconds; empty = no header
}

func (e serverCause) Error() string {
	if e.cause == nil {
		return "retry after " + e.retryAfter + "s"
	}
	return e.cause.Error()
}

func (e serverCause) Unwrap() error { return e.cause }

// ToConnectError maps a module's domain error kinds onto ConnectRPC status
// codes without leaking internal error details (see docs/content/server/architecture.md,
// "Error architecture"). Every module's transport layer uses this instead
// of hand-rolling its own mapping.
//
// Clients receive only the domain message (never the operation name or a
// wrapped infrastructure error). Anything unclassified becomes CodeInternal
// with a generic message and the cause attached for ErrorLogInterceptor.
func ToConnectError(err error) error {
	if connErr, ok := errors.AsType[*connect.Error](err); ok && connErr != nil {
		return connErr
	}

	switch {
	case errors.Is(err, context.Canceled):
		return connect.NewError(connect.CodeCanceled, "request canceled")
	case errors.Is(err, context.DeadlineExceeded):
		return connect.NewError(connect.CodeDeadlineExceeded, "deadline exceeded")
	}

	msg := clientMessage(err)
	switch sharederrors.KindOf(err) {
	case sharederrors.KindNotFound:
		return withDetails(connect.NewError(connect.CodeNotFound, msg), errorInfo(reasonOf(err, ReasonNotFound), nil))
	case sharederrors.KindAlreadyExists:
		return withDetails(connect.NewError(connect.CodeAlreadyExists, msg), errorInfo(reasonOf(err, ReasonAlreadyExists), nil))
	case sharederrors.KindConflict:
		reason := reasonOf(err, ReasonConflict)
		return withDetails(connect.NewError(connect.CodeAborted, msg), errorInfo(reason, nil), preconditionFailure(reason, msg))
	case sharederrors.KindValidation:
		return withDetails(connect.NewError(connect.CodeInvalidArgument, msg), errorInfo(reasonOf(err, ReasonInvalidArgument), nil))
	case sharederrors.KindUnauthorized:
		return withDetails(connect.NewError(connect.CodeUnauthenticated, msg), errorInfo(reasonOf(err, ReasonUnauthenticated), nil))
	case sharederrors.KindRateLimited:
		e := withDetails(connect.NewError(connect.CodeResourceExhausted, msg),
			errorInfo(reasonOf(err, ReasonRateLimited), nil), retryInfo(rateLimitRetrySeconds))
		return withRetryAfter(e, rateLimitRetrySeconds)
	case sharederrors.KindForbidden:
		return permissionDenied(msg, reasonOf(err, ReasonPermissionDenied), nil)
	case sharederrors.KindFailedPrecondition:
		reason := reasonOf(err, ReasonFailedPrecondition)
		return withDetails(connect.NewError(connect.CodeFailedPrecondition, msg), errorInfo(reason, nil), preconditionFailure(reason, msg))
	case sharederrors.KindUnavailable:
		e := withDetails(connect.NewError(connect.CodeUnavailable, msg).WithCause(err),
			errorInfo(reasonOf(err, ReasonUnavailable), nil), retryInfo(retryAfterSeconds))
		return withRetryAfter(e, retryAfterSeconds)
	case sharederrors.KindTimeout:
		return withDetails(connect.NewError(connect.CodeDeadlineExceeded, msg).WithCause(err), errorInfo(reasonOf(err, ReasonTimeout), nil))
	case sharederrors.KindUnknown:
		fallthrough
	default:
		return connect.NewError(connect.CodeInternal, internalMessage).WithCause(err)
	}
}

// retryAfterSeconds is the Retry-After hint sent with UNAVAILABLE: long enough for
// a pod restart or a failover to settle, short enough for an interactive client.
const retryAfterSeconds = "5"

// rateLimitRetrySeconds is the hint sent with a domain-level RESOURCE_EXHAUSTED.
const rateLimitRetrySeconds = "1"

// withRetryAfter marks e to be answered with a Retry-After header (seconds).
// The header is written by ErrorHeadersInterceptor, which must be in the chain
// outside the interceptor that returns e.
func withRetryAfter(e *connect.Error, seconds string) *connect.Error {
	var cause error
	if inner, ok := errors.AsType[serverCause](e); ok {
		cause = inner.cause
	} else {
		cause = e.Unwrap()
	}
	hinted := connect.NewError(e.Code(), e.Message()).WithCause(serverCause{cause: cause, retryAfter: seconds})
	for _, d := range e.Details() {
		hinted = hinted.WithDetail(d)
	}
	return hinted
}

// clientMessage is the safe-to-show text of a classified domain error.
func clientMessage(err error) string {
	var domainErr *sharederrors.Error
	if errors.As(err, &domainErr) && domainErr.Message != "" {
		return domainErr.Message
	}
	return unclassifiedMsg
}

// ErrorHeadersInterceptor writes the response headers an error asks for
// (today: Retry-After, see withRetryAfter) onto the call. connect v2 errors
// carry no metadata, so without it the hint would be silently lost. Place it
// outside every interceptor that returns such errors.
func ErrorHeadersInterceptor() connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			err := next(ctx, spec, stream)
			if err == nil {
				return nil
			}
			if sc, ok := errors.AsType[serverCause](err); ok && sc.retryAfter != "" {
				callInfo(ctx).ResponseHeader().Set("Retry-After", sc.retryAfter)
			}
			return err
		}
	}
}

// ErrorLogInterceptor logs every server-side failure with its real cause and
// records it on the request span. Without it a 500 is invisible: the client
// gets "internal error" by design and nothing else in the stack sees the
// cause. Client errors (invalid argument, not found, ...) are the caller's
// doing and are not logged here; cancellations by the client are not faults.
func ErrorLogInterceptor(logger *slog.Logger) connect.ServerInterceptor {
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			err := next(ctx, spec, stream)
			if err == nil {
				return nil
			}
			code := connect.CodeOf(err)
			var level slog.Level
			switch code {
			case connect.CodeInternal, connect.CodeUnknown, connect.CodeDataLoss:
				level = slog.LevelError
			case connect.CodeDeadlineExceeded, connect.CodeUnavailable:
				level = slog.LevelWarn
			default:
				return err
			}

			cause := causeOf(err)
			logger.Log(ctx, level, "rpc failed",
				slog.String("procedure", spec.Procedure),
				slog.String("code", code.String()),
				slog.Any("error", cause),
			)
			if span := trace.SpanFromContext(ctx); span.IsRecording() {
				span.RecordError(cause)
				span.SetStatus(codes.Error, code.String())
			}
			return err
		}
	}
}

// causeOf digs the server-side cause out of an error produced by ToConnectError.
func causeOf(err error) error {
	if sc, ok := errors.AsType[serverCause](err); ok && sc.cause != nil {
		return sc.cause
	}
	if connErr, ok := errors.AsType[*connect.Error](err); ok && connErr != nil {
		if cause := connErr.Unwrap(); cause != nil {
			return cause
		}
	}
	return err
}
