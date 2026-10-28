package transport_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	authv1 "github.com/aedst/server/gen/go/aedst/auth/v1"
	"github.com/aedst/server/internal/modules/auth/api"
	"github.com/aedst/server/internal/modules/auth/transport"
	platformauth "github.com/aedst/server/internal/platform/auth"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type fakeService struct {
	api.Service

	err    error
	userID ids.ID
	pair   api.TokenPair
}

func (f *fakeService) Register(_ context.Context, email, _, _ string) (api.User, api.TokenPair, error) {
	return api.User{ID: f.userID, Email: email, CreatedAt: time.Unix(1, 0)}, f.pair, f.err
}

func (f *fakeService) Login(context.Context, string, string, string) (ids.ID, api.TokenPair, error) {
	return f.userID, f.pair, f.err
}

func (f *fakeService) GetCurrentUser(_ context.Context, userID ids.ID) (api.User, error) {
	f.userID = userID
	return api.User{ID: userID, Email: "a@example.com"}, f.err
}

func TestRegisterAndLogin_ReturnTokensWithoutLeakingInternals(t *testing.T) {
	user := ids.New()
	svc := &fakeService{userID: user, pair: api.TokenPair{AccessToken: "a", RefreshToken: "r", AccessTTL: 15 * time.Minute, RefreshTTL: time.Hour}}
	handler := transport.NewHandler(svc)

	reg, err := handler.Register(context.Background(), &authv1.RegisterRequest{Email: "a@example.com", Password: "pw"})
	if err != nil {
		t.Fatalf("Register: %v", err)
	}
	if reg.GetUser().GetId() != user.String() || reg.GetTokens().GetAccessTokenExpiresInSeconds() != 900 || reg.GetTokens().GetRefreshToken() != "r" {
		t.Errorf("Register response = %+v", reg)
	}
	login, err := handler.Login(context.Background(), &authv1.LoginRequest{Email: "a@example.com", Password: "pw"})
	if err != nil || login.GetUserId() != user.String() {
		t.Fatalf("Login = %+v, %v", login, err)
	}

	svc.err = sharederrors.Unauthorized("auth.Login", "invalid email or password")
	if _, err := handler.Login(context.Background(), &authv1.LoginRequest{}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("bad credentials = %v, want Unauthenticated", err)
	}
	svc.err = sharederrors.RateLimited("auth.Login", "too many attempts")
	if _, err := handler.Login(context.Background(), &authv1.LoginRequest{}); connect.CodeOf(err) != connect.CodeResourceExhausted {
		t.Errorf("throttled login = %v, want ResourceExhausted", err)
	}
	svc.err = sharederrors.AlreadyExists("auth.Register", "email already registered")
	if _, err := handler.Register(context.Background(), &authv1.RegisterRequest{}); connect.CodeOf(err) != connect.CodeAlreadyExists {
		t.Errorf("duplicate email = %v, want AlreadyExists", err)
	}
	svc.err = sharederrors.Wrap("auth.Register", errors.New("relation auth.credentials does not exist"))
	_, err = handler.Register(context.Background(), &authv1.RegisterRequest{})
	if connect.CodeOf(err) != connect.CodeInternal || err.Error() != "internal: internal error" {
		t.Errorf("infrastructure failure = %v, want an opaque Internal", err)
	}
}

// GetCurrentUser must use the identity the auth interceptor verified, never a
// request field.
func TestGetCurrentUser_UsesTheAuthenticatedIdentity(t *testing.T) {
	user := ids.New()
	svc := &fakeService{}
	handler := transport.NewHandler(svc)

	ctx := platformauth.WithIdentity(context.Background(), platformauth.Identity{UserID: user})
	resp, err := handler.GetCurrentUser(ctx, &authv1.GetCurrentUserRequest{})
	if err != nil || svc.userID != user || resp.GetUser().GetId() != user.String() {
		t.Fatalf("GetCurrentUser = %+v, %v; service saw %s, want %s", resp, err, svc.userID, user)
	}
	if _, err := handler.GetCurrentUser(context.Background(), &authv1.GetCurrentUserRequest{}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Fatalf("no identity = %v, want Unauthenticated", err)
	}
}
