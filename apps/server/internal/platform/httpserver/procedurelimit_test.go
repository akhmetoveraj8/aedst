package httpserver_test

import (
	"context"
	"errors"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"

	appattestv1 "github.com/aedst/server/gen/go/aedst/appattest/v1"
	capabilitiesv1 "github.com/aedst/server/gen/go/aedst/capabilities/v1"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/shared/ids"
)

func TestProcedureRateLimit_KeysBucketsAndFailOpen(t *testing.T) {
	const service = "/test.v1.Svc/"
	user := ids.New()
	ok := func(context.Context) error { return nil }
	identity := withIdentity(platformauth.Identity{UserID: user})

	tests := []struct {
		name    string
		limits  map[string]httpserver.ProcedureLimit
		wantKey string // "" = the limiter must not be asked
	}{
		{"exact entry has its own counter", map[string]httpserver.ProcedureLimit{testProcedure: {PerMinute: 10}}, "rl:proc:" + testProcedure + ":" + user.String()},
		{"service wildcard is one counter", map[string]httpserver.ProcedureLimit{service + "*": {PerMinute: 10}}, "rl:proc:" + service + "*:" + user.String()},
		{"exact wins over the wildcard", map[string]httpserver.ProcedureLimit{service + "*": {PerMinute: 10}, testProcedure: {PerMinute: 5, Bucket: "flow"}}, "rl:proc:flow:" + user.String()},
		{"another procedure's limit does not apply", map[string]httpserver.ProcedureLimit{"/other.v1.Svc/Do": {PerMinute: 1}}, ""},
		{"a zero limit is no limit", map[string]httpserver.ProcedureLimit{testProcedure: {}}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			limiter := &stubLimiter{allowed: true}
			if err := serve(t, ok, identity, httpserver.ProcedureRateLimitInterceptor(limiter, tt.limits, discardLogger()))(); err != nil {
				t.Fatalf("within budget: %v", err)
			}
			if got := strings.Join(limiter.keys, ","); got != tt.wantKey {
				t.Fatalf("limiter keys = %q, want %q", got, tt.wantKey)
			}
		})
	}

	// Over budget: RESOURCE_EXHAUSTED with RATE_LIMITED, RetryInfo and Retry-After
	// (10 per minute refills one unit every 6 seconds).
	limits := map[string]httpserver.ProcedureLimit{testProcedure: {PerMinute: 10}}
	limiter := &stubLimiter{allowed: false}
	call := serve(t, ok, identity, httpserver.ProcedureRateLimitInterceptor(limiter, limits, discardLogger()))
	var info *connect.CallInfo
	ce, details := detailsOf(t, call(func(i *connect.CallInfo) { info = i }))
	if ce.Code() != connect.CodeResourceExhausted || details.info.GetReason() != httpserver.ReasonRateLimited {
		t.Fatalf("over budget = %v / %v", ce.Code(), details.info)
	}
	if info.ResponseHeader().Get("Retry-After") != "6" || details.retry.GetRetryDelay().GetSeconds() != 6 {
		t.Errorf("retry hint = header %q, RetryInfo %v; want 6s", info.ResponseHeader().Get("Retry-After"), details.retry)
	}

	// A limiter outage fails open; a call without an identity is not counted.
	limiter.err = errors.New("cache down") // degraded: the stub plays cache.RateLimiter's in-process fallback
	if err := call(); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Fatalf("during a limiter outage the fallback decision (over budget) must be honoured, got %v", err)
	}
	limiter.allowed = true
	if err := call(); err != nil {
		t.Fatalf("during a limiter outage a request within the fallback budget must pass, got %v", err)
	}
	anonymous := &stubLimiter{allowed: false}
	if err := serve(t, ok, httpserver.ProcedureRateLimitInterceptor(anonymous, limits, discardLogger()))(); err != nil || len(anonymous.keys) != 0 {
		t.Fatalf("anonymous call = %v, keys %v; want it to pass untouched", err, anonymous.keys)
	}
}

func TestProcedureLimits_ParseMergeValidate(t *testing.T) {
	const (
		enroll = "/aedst.appattest.v1.AppAttestService/Enroll"
		assert = "/aedst.appattest.v1.AppAttestService/VerifyAssertion"
		public = "/aedst.capabilities.v1.CapabilitiesService/GetCapabilities"
	)
	known := httpserver.ProceduresOf(appattestv1.File_aedst_appattest_v1_appattest_proto, capabilitiesv1.File_aedst_capabilities_v1_capabilities_proto)
	publicSet := map[string]bool{public: true}

	configured, err := httpserver.ParseProcedureLimits(map[string]int{" " + enroll: 5, assert: 0})
	if err != nil {
		t.Fatal(err)
	}
	defaults := map[string]httpserver.ProcedureLimit{
		enroll: {PerMinute: 10, Bucket: "appattest:enroll"},
		assert: {PerMinute: 120, Bucket: "appattest:assert"},
	}
	merged := httpserver.MergeProcedureLimits(defaults, configured)
	if got := merged[enroll]; got.PerMinute != 5 || got.Bucket != "" {
		t.Errorf("override = %+v, want the configured 5 with its own counter", got)
	}
	if _, kept := merged[assert]; kept {
		t.Error("a configured 0 must switch the built-in limit off")
	}
	if err := httpserver.ValidateProcedureLimits(merged, known, publicSet); err != nil {
		t.Fatalf("valid limits rejected: %v", err)
	}

	if _, err := httpserver.ParseProcedureLimits(map[string]int{enroll: -1}); err == nil {
		t.Error("a negative limit must be rejected")
	}
	for name, limits := range map[string]map[string]httpserver.ProcedureLimit{
		"unknown procedure": {"/aedst.appattest.v1.AppAttestService/Enrol": {PerMinute: 1}},
		"unknown service":   {"/aedst.nope.v1.NopeService/*": {PerMinute: 1}},
		"public procedure":  {public: {PerMinute: 1}},
	} {
		if err := httpserver.ValidateProcedureLimits(limits, known, publicSet); err == nil || !strings.Contains(err.Error(), name) {
			t.Errorf("%s: err = %v, want it reported at startup", name, err)
		}
	}
}
