// Package transport implements the auth module's ConnectRPC handlers. It
// depends only on modules/auth/api — never on application/domain/
// infrastructure directly (see docs/content/server/modules.md).
package transport

import (
	"context"

	"google.golang.org/protobuf/types/known/timestamppb"

	authv1 "github.com/aedst/server/gen/go/aedst/auth/v1"
	"github.com/aedst/server/internal/modules/auth/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
)

type Handler struct {
	service api.Service
}

func NewHandler(service api.Service) *Handler {
	return &Handler{service: service}
}

func (h *Handler) Register(ctx context.Context, req *authv1.RegisterRequest) (*authv1.RegisterResponse, error) {
	user, pair, err := h.service.Register(ctx, req.GetEmail(), req.GetPassword(), req.GetDeviceId())
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &authv1.RegisterResponse{
		User:   toProtoUser(user),
		Tokens: toProtoTokenPair(pair),
	}, nil
}

func (h *Handler) Login(ctx context.Context, req *authv1.LoginRequest) (*authv1.LoginResponse, error) {
	userID, pair, err := h.service.Login(ctx, req.GetEmail(), req.GetPassword(), req.GetDeviceId())
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &authv1.LoginResponse{
		UserId: userID.String(),
		Tokens: toProtoTokenPair(pair),
	}, nil
}

func (h *Handler) RefreshToken(ctx context.Context, req *authv1.RefreshTokenRequest) (*authv1.RefreshTokenResponse, error) {
	pair, err := h.service.RefreshToken(ctx, req.GetRefreshToken())
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &authv1.RefreshTokenResponse{Tokens: toProtoTokenPair(pair)}, nil
}

func (h *Handler) Logout(ctx context.Context, req *authv1.LogoutRequest) (*authv1.LogoutResponse, error) {
	if err := h.service.Logout(ctx, req.GetRefreshToken()); err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &authv1.LogoutResponse{}, nil
}

func (h *Handler) GetCurrentUser(ctx context.Context, _ *authv1.GetCurrentUserRequest) (*authv1.GetCurrentUserResponse, error) {
	identity, ok := platformauth.FromContext(ctx)
	if !ok {
		// Unreachable in practice: GetCurrentUser is never in
		// publicProcedures, so AuthInterceptor has already rejected any
		// request that reaches here without a verified identity. Guarded
		// anyway rather than trusting that wiring never changes.
		return nil, httpserver.ToConnectError(sharederrors.Unauthorized("auth.GetCurrentUser", "missing identity"))
	}

	user, err := h.service.GetCurrentUser(ctx, identity.UserID)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &authv1.GetCurrentUserResponse{User: toProtoUser(user)}, nil
}

func toProtoUser(user api.User) *authv1.User {
	return &authv1.User{
		Id:        user.ID.String(),
		Email:     user.Email,
		CreatedAt: timestamppb.New(user.CreatedAt),
	}
}

func toProtoTokenPair(pair api.TokenPair) *authv1.TokenPair {
	return &authv1.TokenPair{
		AccessToken:                  pair.AccessToken,
		RefreshToken:                 pair.RefreshToken,
		AccessTokenExpiresInSeconds:  int64(pair.AccessTTL.Seconds()),
		RefreshTokenExpiresInSeconds: int64(pair.RefreshTTL.Seconds()),
	}
}
