// Package application holds the webhooks module's use cases: the endpoint
// registry and the delivery log an operator manages. It depends on the domain
// and on the ports below; the adapters live in infrastructure.
package application

import (
	"context"
	"time"

	"github.com/aedst/server/internal/modules/webhooks/domain"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// Idempotency carries a client's Idempotency-Key for a write, with the scope
// ("webhooks:<caller id>") that namespaces it. An empty Key means none was sent.
type Idempotency struct {
	Scope string
	Key   string
}

// Repository is the module's storage. Every method that changes state is one
// statement or one transaction.
type Repository interface {
	// CreateEndpoint stores the endpoint with its sealed secret. With an
	// idempotency key that was already used for the same request it stores
	// nothing and returns the endpoint and sealed secret of the first call.
	CreateEndpoint(ctx context.Context, endpoint domain.Endpoint, sealed []byte, idem Idempotency) (domain.Endpoint, []byte, error)
	GetEndpoint(ctx context.Context, id ids.ID) (domain.Endpoint, error)
	ListEndpoints(ctx context.Context, limit int, after *pagination.Cursor) (domain.EndpointPage, error)
	RotateSecret(ctx context.Context, id ids.ID, sealed []byte, now time.Time) (domain.Endpoint, error)
	// DisableEndpoint and EnableEndpoint are guarded transitions: calling one on
	// an endpoint already in that state returns it unchanged.
	DisableEndpoint(ctx context.Context, id ids.ID, reason domain.DisabledReason, now time.Time) (domain.Endpoint, error)
	EnableEndpoint(ctx context.Context, id ids.ID, now time.Time) (domain.Endpoint, error)
	DeleteEndpoint(ctx context.Context, id ids.ID) error
	ListDeliveries(ctx context.Context, endpointID ids.ID, limit int, after *pagination.Cursor) (domain.DeliveryPage, error)
	// RequeueDelivery moves a failed or cancelled delivery of an active endpoint
	// back to pending and enqueues its job in the same transaction. requeued is
	// false when the guard refused; the returned delivery is then its current state.
	RequeueDelivery(ctx context.Context, id ids.ID, now time.Time) (delivery domain.Delivery, requeued bool, err error)
}

// Sealer encrypts signing secrets at rest. The endpoint id is bound to the
// ciphertext, so a sealed secret cannot be moved to another endpoint's row.
type Sealer interface {
	Seal(endpointID ids.ID, secret string) ([]byte, error)
	Open(endpointID ids.ID, sealed []byte) (string, error)
}
