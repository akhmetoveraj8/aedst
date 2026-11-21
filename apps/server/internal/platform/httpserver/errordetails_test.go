package httpserver_test

import (
	"context"
	"errors"
	"net"
	"syscall"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// statementTimeout is a Postgres statement_timeout as the driver reports it.
type statementTimeout struct{}

func (statementTimeout) Error() string    { return "canceling statement due to statement timeout" }
func (statementTimeout) SQLState() string { return "57014" }

// wireDetails is what a client can read from an error that crossed the wire.
type wireDetails struct {
	info         *errdetails.ErrorInfo
	retry        *errdetails.RetryInfo
	precondition *errdetails.PreconditionFailure
}

func detailsOf(t *testing.T, err error) (*connect.Error, wireDetails) {
	t.Helper()
	ce, ok := errors.AsType[*connect.Error](err)
	if !ok {
		t.Fatalf("not a connect error: %v", err)
	}
	var out wireDetails
	for _, d := range ce.Details() {
		msg, derr := connectproto.UnmarshalErrorDetail(d)
		if derr != nil {
			t.Fatalf("detail does not decode: %v", derr)
		}
		switch v := msg.(type) {
		case *errdetails.ErrorInfo:
			out.info = v
		case *errdetails.RetryInfo:
			out.retry = v
		case *errdetails.PreconditionFailure:
			out.precondition = v
		}
	}
	return ce, out
}

// Every classified error reaches the client with its code, a machine-readable
// ErrorInfo reason in the "aedst" domain and the typed detail its case promises
// (docs/content/engineering/api-design.md, "Errors").
func TestToConnectError_TypedDetailsOnTheWire(t *testing.T) {
	tests := []struct {
		name         string
		err          error
		code         connect.Code
		reason       string
		retry        time.Duration // 0 = no RetryInfo and no Retry-After
		precondition string        // violation type; "" = none
	}{
		{"not found", sharederrors.NotFound("op", "missing"), connect.CodeNotFound, "NOT_FOUND", 0, ""},
		{"already exists", sharederrors.AlreadyExists("op", "dup"), connect.CodeAlreadyExists, "ALREADY_EXISTS", 0, ""},
		{"conflict default", sharederrors.Conflict("op", "changed"), connect.CodeAborted, "CONFLICT", 0, "CONFLICT"},
		{"stale version", sharederrors.Conflict("op", "changed").WithReason("STALE_VERSION"), connect.CodeAborted, "STALE_VERSION", 0, "STALE_VERSION"},
		{"validation", sharederrors.Validation("op", "bad"), connect.CodeInvalidArgument, "INVALID_ARGUMENT", 0, ""},
		{"unauthorized", sharederrors.Unauthorized("op", "no"), connect.CodeUnauthenticated, "UNAUTHENTICATED", 0, ""},
		{"forbidden", sharederrors.Forbidden("op", "no"), connect.CodePermissionDenied, "PERMISSION_DENIED", 0, ""},
		{"rate limited", sharederrors.RateLimited("op", "slow down"), connect.CodeResourceExhausted, "RATE_LIMITED", time.Second, ""},
		{"failed precondition", sharederrors.FailedPrecondition("op", "disabled").WithReason("FEATURE_DISABLED"), connect.CodeFailedPrecondition, "FEATURE_DISABLED", 0, "FEATURE_DISABLED"},
		{"unavailable", sharederrors.Wrap("op", &net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}), connect.CodeUnavailable, "UNAVAILABLE", 5 * time.Second, ""},
		{"timeout", sharederrors.Wrap("op", statementTimeout{}), connect.CodeDeadlineExceeded, "TIMEOUT", 0, ""},
		{"internal carries no detail", sharederrors.Wrap("op", errors.New("boom")), connect.CodeInternal, "", 0, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			failure := httpserver.ToConnectError(tt.err)
			call := serve(t, func(context.Context) error { return failure }, httpserver.ErrorHeadersInterceptor())
			var info *connect.CallInfo
			ce, got := detailsOf(t, call(func(i *connect.CallInfo) { info = i }))
			if ce.Code() != tt.code {
				t.Fatalf("code = %v, want %v", ce.Code(), tt.code)
			}
			switch {
			case tt.reason == "" && got.info != nil:
				t.Fatalf("unexpected ErrorInfo %v", got.info)
			case tt.reason != "" && (got.info == nil || got.info.GetReason() != tt.reason || got.info.GetDomain() != httpserver.ErrorDomain):
				t.Fatalf("ErrorInfo = %v, want reason %s in domain %s", got.info, tt.reason, httpserver.ErrorDomain)
			}
			if gotRetry := got.retry.GetRetryDelay().AsDuration(); gotRetry != tt.retry {
				t.Errorf("RetryInfo delay = %v, want %v", gotRetry, tt.retry)
			}
			if hasHeader := info.ResponseHeader().Get("Retry-After") != ""; hasHeader != (tt.retry > 0) {
				t.Errorf("Retry-After present = %v, want %v", hasHeader, tt.retry > 0)
			}
			var violation string
			if v := got.precondition.GetViolations(); len(v) == 1 {
				violation = v[0].GetType()
			}
			if violation != tt.precondition {
				t.Errorf("PreconditionFailure type = %q, want %q", violation, tt.precondition)
			}
		})
	}
}

func TestUserRateLimit_AnswersRetryInfoAndReason(t *testing.T) {
	call := serve(t, func(context.Context) error { return nil },
		withIdentity(platformauth.Identity{UserID: ids.New()}), httpserver.UserRateLimitInterceptor(&stubLimiter{allowed: false}, 1, discardLogger()))
	var info *connect.CallInfo
	ce, got := detailsOf(t, call(func(i *connect.CallInfo) { info = i }))
	if ce.Code() != connect.CodeResourceExhausted || got.info.GetReason() != httpserver.ReasonRateLimited {
		t.Fatalf("got %v / %v, want RESOURCE_EXHAUSTED with RATE_LIMITED", ce.Code(), got.info)
	}
	if got.retry.GetRetryDelay().AsDuration() != time.Second || info.ResponseHeader().Get("Retry-After") != "1" {
		t.Errorf("retry hint = %v / header %q, want 1s in both", got.retry, info.ResponseHeader().Get("Retry-After"))
	}
}
