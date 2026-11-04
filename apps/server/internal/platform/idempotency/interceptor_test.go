package idempotency_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"

	"github.com/aedst/server/internal/platform/idempotency"
)

func TestCheck_ScopesKeysAndSerializes(t *testing.T) {
	store := newFakeStore()
	ctx := context.Background()
	payload := []byte("p")

	if _, _, err := idempotency.Check(ctx, nil, store, "user-a", "k", payload); err != nil {
		t.Fatalf("Check: %v", err)
	}
	if err := idempotency.Save(ctx, nil, store, "user-a", "k", payload, []byte("result-a")); err != nil {
		t.Fatalf("Save: %v", err)
	}

	// Same key, another caller's scope: a miss, never user-a's result.
	result, replay, err := idempotency.Check(ctx, nil, store, "user-b", "k", payload)
	if err != nil || replay || result != nil {
		t.Fatalf("Check in another scope = %q, replay %v, %v; want a clean miss", result, replay, err)
	}

	if store.acquired != 2 {
		t.Errorf("Acquire called %d times, want once per Check with a key", store.acquired)
	}
	if _, _, err := idempotency.Check(ctx, nil, store, "user-a", "", payload); err != nil || store.acquired != 2 {
		t.Errorf("an empty key must not take a lock (acquired = %d, err = %v)", store.acquired, err)
	}
}

func TestHeaderInterceptor_ValidatesKey(t *testing.T) {
	seen := ""
	server := connect.NewServer(idempotency.HeaderInterceptor())
	server.Register(connect.Method{
		Spec: connect.Spec{Procedure: "/test.v1.Svc/Do", StreamType: connect.StreamTypeUnary},
		Handler: func(ctx context.Context, _ connect.Spec, _ connect.ServerStream) error {
			seen, _ = idempotency.KeyFromContext(ctx)
			return nil
		},
	})

	tests := []struct {
		name    string
		key     string
		wantErr bool
	}{
		{"absent", "", false},
		{"uuid", "3f2b8a52-7d3c-4f0e-9d8e-1d6b1c9a0a11", false},
		{"max length", strings.Repeat("a", idempotency.MaxKeyLength), false},
		{"too long", strings.Repeat("a", idempotency.MaxKeyLength+1), true},
		{"space", "a b", true},
		{"control character", "a\x01b", true},
		{"non-ASCII", "ключ", true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			seen = ""
			info := &connect.CallInfo{}
			if tt.key != "" {
				info.RequestHeader().Set(idempotency.HeaderName, tt.key)
			}
			err := server.Call(context.Background(), "/test.v1.Svc/Do", info, nil)
			if tt.wantErr {
				if connect.CodeOf(err) != connect.CodeInvalidArgument {
					t.Fatalf("err = %v, want InvalidArgument", err)
				}
				return
			}
			if err != nil || seen != tt.key {
				t.Fatalf("err = %v, key on context %q; want the key passed through", err, seen)
			}
		})
	}
}
