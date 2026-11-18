package transport

import (
	"context"

	mediav1 "github.com/aedst/server/gen/go/aedst/media/v1"
	"github.com/aedst/server/internal/modules/media/api"
	"github.com/aedst/server/internal/platform/httpserver"
)

// OperatorHandler serves MediaOperatorService: the cross-owner read the admin
// module reaches when media runs in another process. Who may call it is the role
// policy's business (module.operatorRoles), not this handler's.
type OperatorHandler struct{ stats api.Stats }

// NewOperatorHandler builds the handler over the operator api.
func NewOperatorHandler(stats api.Stats) *OperatorHandler { return &OperatorHandler{stats: stats} }

func (h *OperatorHandler) GetTotals(ctx context.Context, _ *mediav1.GetTotalsRequest) (*mediav1.GetTotalsResponse, error) {
	count, bytes, err := h.stats.Totals(ctx)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &mediav1.GetTotalsResponse{Count: count, Bytes: bytes}, nil
}
