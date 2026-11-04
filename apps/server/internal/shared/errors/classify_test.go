package errors_test

import (
	"context"
	"errors"
	"fmt"
	"io"
	"net"
	"syscall"
	"testing"

	sharederrors "github.com/aedst/server/internal/shared/errors"
)

type sqlStateErr string

func (e sqlStateErr) Error() string    { return "pg error " + string(e) }
func (e sqlStateErr) SQLState() string { return string(e) }

type timeoutNetErr struct{}

func (timeoutNetErr) Error() string   { return "i/o timeout" }
func (timeoutNetErr) Timeout() bool   { return true }
func (timeoutNetErr) Temporary() bool { return true }

func TestWrapClassifiesInfrastructureFailures(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want sharederrors.Kind
	}{
		{"deadline", fmt.Errorf("query: %w", context.DeadlineExceeded), sharederrors.KindTimeout},
		{"net timeout", &net.OpError{Op: "read", Err: timeoutNetErr{}}, sharederrors.KindTimeout},
		{"connection refused", &net.OpError{Op: "dial", Err: syscall.ECONNREFUSED}, sharederrors.KindUnavailable},
		{"reset", fmt.Errorf("put: %w", syscall.ECONNRESET), sharederrors.KindUnavailable},
		{"unexpected EOF", fmt.Errorf("get: %w", io.ErrUnexpectedEOF), sharederrors.KindUnavailable},
		{"statement timeout", sqlStateErr("57014"), sharederrors.KindTimeout},
		{"connection exception", sqlStateErr("08006"), sharederrors.KindUnavailable},
		{"too many connections", sqlStateErr("53300"), sharederrors.KindUnavailable},
		{"cannot connect now", sqlStateErr("57P03"), sharederrors.KindUnavailable},
		{"constraint violation is a bug here", sqlStateErr("23505"), sharederrors.KindUnknown},
		{"plain", errors.New("boom"), sharederrors.KindUnknown},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got := sharederrors.Wrap("op", tt.err)
			if got.Kind != tt.want {
				t.Fatalf("Wrap(%v).Kind = %v, want %v", tt.err, got.Kind, tt.want)
			}
			if !errors.Is(got, tt.err) {
				t.Fatal("the cause must stay reachable for logs")
			}
		})
	}
}
