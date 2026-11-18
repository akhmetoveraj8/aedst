package transport

import (
	"context"

	"connectrpc.com/connect/v2"

	notificationsv1 "github.com/aedst/server/gen/go/aedst/notifications/v1"
	"github.com/aedst/server/internal/modules/notifications/api"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/shared/ids"
)

// OperatorHandler serves NotificationsOperatorService: the surface the admin
// module reaches when notifications runs in another process. Who may call it is
// the role policy's business (module.operatorRoles), not this handler's.
type OperatorHandler struct{ operator api.Operator }

// NewOperatorHandler builds the handler over the operator api.
func NewOperatorHandler(operator api.Operator) *OperatorHandler {
	return &OperatorHandler{operator: operator}
}

func (h *OperatorHandler) CountAllActiveDevices(ctx context.Context, _ *notificationsv1.CountAllActiveDevicesRequest) (*notificationsv1.CountAllActiveDevicesResponse, error) {
	n, err := h.operator.CountActiveDevices(ctx)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &notificationsv1.CountAllActiveDevicesResponse{Devices: n}, nil
}

func (h *OperatorHandler) OperatorBroadcast(ctx context.Context, req *notificationsv1.OperatorBroadcastRequest) (*notificationsv1.OperatorBroadcastResponse, error) {
	var user *ids.ID
	if req.GetUserId() != "" {
		id, err := ids.Parse(req.GetUserId())
		if err != nil {
			return nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
		}
		user = &id
	}
	n, err := h.operator.BroadcastIdempotent(ctx, req.GetIdempotencyKey(), user,
		api.Broadcast{Title: req.GetTitle(), Body: req.GetBody(), Link: req.GetLink()})
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &notificationsv1.OperatorBroadcastResponse{Recipients: n}, nil
}
