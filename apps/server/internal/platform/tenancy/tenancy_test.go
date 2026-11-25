package tenancy_test

import (
	"context"
	"errors"
	"testing"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/tenancy"
	"github.com/aedst/server/internal/shared/ids"
)

func TestScopeOf(t *testing.T) {
	t.Parallel()
	user := ids.FromExternal("https://idp.example", "alice")
	got := tenancy.ScopeOf(platformauth.Identity{UserID: user, TenantID: "org-42"})
	if got.TenantID != "org-42" || got.UserID != user.String() {
		t.Fatalf("ScopeOf = %+v", got)
	}
}

// Without an authenticated caller there is no scope to apply; the call fails before
// touching the transaction (nil here), so a background job cannot run unscoped by accident.
func TestApplyFromContext_RequiresIdentity(t *testing.T) {
	t.Parallel()
	if err := tenancy.ApplyFromContext(context.Background(), nil); !errors.Is(err, tenancy.ErrNoIdentity) {
		t.Fatalf("err = %v, want ErrNoIdentity", err)
	}
}
