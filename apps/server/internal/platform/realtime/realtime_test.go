package realtime_test

import (
	"context"
	"errors"
	"testing"
	"time"

	connect "connectrpc.com/connect/v2"

	realtimev1 "github.com/aedst/server/gen/go/aedst/realtime/v1"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/realtime"
	"github.com/aedst/server/internal/shared/ids"
)

func TestGetConnectionAccessReturnsTheCallersOwnerIDAndTokenExpiry(t *testing.T) {
	user := ids.New()
	exp := time.Date(2026, 11, 28, 12, 0, 0, 0, time.UTC)
	ctx := platformauth.WithIdentity(context.Background(), platformauth.Identity{UserID: user, ExpiresAt: exp})

	got, err := realtime.Handler{}.GetConnectionAccess(ctx, &realtimev1.GetConnectionAccessRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if got.GetUserId() != user.String() || !got.GetExpiresAt().AsTime().Equal(exp) {
		t.Fatalf("got %v, want user %s expiring %s", got, user, exp)
	}
}

func TestGetConnectionAccessRefusesACallWithoutAVerifiedIdentity(t *testing.T) {
	for name, ctx := range map[string]context.Context{
		"no identity": context.Background(),
		"no expiry":   platformauth.WithIdentity(context.Background(), platformauth.Identity{UserID: ids.New()}),
		"no user":     platformauth.WithIdentity(context.Background(), platformauth.Identity{ExpiresAt: time.Now()}),
	} {
		_, err := realtime.Handler{}.GetConnectionAccess(ctx, &realtimev1.GetConnectionAccessRequest{})
		var cerr *connect.Error
		if !errors.As(err, &cerr) || cerr.Code() != connect.CodeUnauthenticated {
			t.Errorf("%s: err = %v, want unauthenticated", name, err)
		}
	}
}
