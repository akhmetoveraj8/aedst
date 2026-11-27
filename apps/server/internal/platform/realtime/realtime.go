// Package realtime is the Go side of the realtime gateway's connection check
// (apps/server/docs/adr/0026-gateway-connection-access-and-protobuf-envelope.md).
//
// When a client opens a WebSocket on the Rust gateway (apps/gateway), the
// gateway calls RealtimeService.GetConnectionAccess with the client's own
// access token as the bearer. The token is verified here by the ordinary auth
// interceptor (httpserver.AuthInterceptor), so the Go server stays the only
// OIDC resource server (ADR-0019) and the gateway holds no OIDC settings, keys
// or verification code. The handler only reads the verified identity.
package realtime

import (
	"context"

	connect "connectrpc.com/connect/v2"
	"google.golang.org/protobuf/types/known/timestamppb"

	realtimev1 "github.com/aedst/server/gen/go/aedst/realtime/v1"
	realtimev1connect "github.com/aedst/server/gen/go/aedst/realtime/v1/realtimev1connect"
	platformauth "github.com/aedst/server/internal/platform/auth"
)

// MaxRequestBytes caps a GetConnectionAccess request (the message is empty).
const MaxRequestBytes = 1 << 10

// Handler is the RealtimeService.
type Handler struct{}

var _ realtimev1connect.RealtimeServiceHandler = Handler{}

// GetConnectionAccess returns the caller's owner id and token expiry. The
// procedure is not public, so the interceptor has already refused a request
// without a valid token; the check below only guards a wiring mistake.
func (Handler) GetConnectionAccess(ctx context.Context, _ *realtimev1.GetConnectionAccessRequest) (*realtimev1.GetConnectionAccessResponse, error) {
	id, ok := platformauth.FromContext(ctx)
	if !ok || id.UserID.IsNil() || id.ExpiresAt.IsZero() {
		return nil, connect.NewError(connect.CodeUnauthenticated, "no authenticated caller")
	}
	return &realtimev1.GetConnectionAccessResponse{
		UserId:    id.UserID.String(),
		ExpiresAt: timestamppb.New(id.ExpiresAt),
	}, nil
}
