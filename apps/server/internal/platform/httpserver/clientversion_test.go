package httpserver_test

import (
	"context"
	"errors"
	"log/slog"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/aedst/server/internal/platform/httpserver"
)

// callGate runs the interceptor with a request carrying header (unset when
// empty) and reports whether the wrapped handler ran, plus the error.
func callGate(t *testing.T, mins map[string]string, header string) (reached bool, err error) {
	t.Helper()
	return callWithHeader(httpserver.ClientVersionInterceptor(context.Background(), mins, nil, slog.New(slog.DiscardHandler)), httpserver.ClientHeader, header)
}

func TestClientVersionInterceptor(t *testing.T) {
	mins := map[string]string{"android": "1.2.0", "apple": "2.0.0"}

	allowed := map[string]string{
		"at the minimum":                "android/1.2.0",
		"above the minimum":             "android/1.10.0",
		"semver compare, not lexical":   "android/1.10.0",
		"leading v tolerated":           "android/v1.3.0",
		"prerelease of a newer version": "apple/2.1.0-beta.1",
		"platform without a minimum":    "web/0.0.1",
		"no header (curl, old builds)":  "",
		"unknown platform":              "toaster/0.1",
		"malformed version":             "android/latest",
		"no slash":                      "android",
	}
	for name, header := range allowed {
		t.Run("allows "+name, func(t *testing.T) {
			if reached, err := callGate(t, mins, header); !reached || err != nil {
				t.Errorf("header %q: reached=%v err=%v, want the handler to run", header, reached, err)
			}
		})
	}

	for name, header := range map[string]string{
		"below the minimum":     "android/1.1.9",
		"major behind":          "apple/1.99.99",
		"prerelease of minimum": "android/1.2.0-rc.1",
		"case-insensitive name": "ANDROID/1.0.0",
	} {
		t.Run("rejects "+name, func(t *testing.T) {
			reached, err := callGate(t, mins, header)
			if reached {
				t.Fatalf("header %q reached the handler, want it rejected", header)
			}
			cerr, isConnectErr := errors.AsType[*connect.Error](err)
			if !isConnectErr || cerr.Code() != connect.CodeFailedPrecondition {
				t.Fatalf("error = %v, want a failed_precondition connect error", err)
			}
			var reason string
			for _, d := range cerr.Details() {
				if v, derr := connectproto.UnmarshalErrorDetail(d); derr == nil {
					if info, ok := v.(*errdetails.ErrorInfo); ok {
						reason = info.GetReason()
					}
				}
			}
			if reason != httpserver.ClientUpgradeRequiredReason {
				t.Errorf("error detail reason = %q, want %q", reason, httpserver.ClientUpgradeRequiredReason)
			}
		})
	}
}

func TestClientVersionInterceptor_DisabledWhenNoMinimums(t *testing.T) {
	for _, mins := range []map[string]string{nil, {}} {
		if reached, err := callGate(t, mins, "android/0.0.1"); !reached || err != nil {
			t.Errorf("mins=%v: reached=%v err=%v, want the gate disabled", mins, reached, err)
		}
	}
}
