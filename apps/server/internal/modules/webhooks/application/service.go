package application

import (
	"context"

	"github.com/aedst/server/internal/modules/webhooks/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// CreateEndpointInput is what an operator supplies to register an endpoint.
type CreateEndpointInput struct {
	URL         string
	Description string
	EventTypes  []string
	// IdempotencyKey is the Idempotency-Key header ("" when absent) and CallerID
	// the authenticated operator it is scoped to.
	IdempotencyKey string
	CallerID       ids.ID
}

// Service implements the module's use cases.
type Service struct {
	repo    Repository
	sealer  Sealer
	clock   sharedtime.Clock
	offered []string
}

// NewService builds the service. offered are the event types endpoints may
// subscribe to (the ones the module's fan-out consumes).
func NewService(repo Repository, sealer Sealer, clock sharedtime.Clock, offered []string) *Service {
	return &Service{repo: repo, sealer: sealer, clock: clock, offered: offered}
}

// CreateEndpoint registers an endpoint and returns its signing secret, the only
// time the secret leaves the server besides a rotation. A replay with the same
// idempotency key returns the first call's endpoint and secret.
func (s *Service) CreateEndpoint(ctx context.Context, in CreateEndpointInput) (domain.Endpoint, string, error) {
	endpoint, err := domain.NewEndpoint(ids.New(), in.URL, in.Description, in.EventTypes, s.offered, s.clock.Now())
	if err != nil {
		return domain.Endpoint{}, "", err
	}
	secret := domain.NewSecret()
	sealed, err := s.sealer.Seal(endpoint.ID, secret)
	if err != nil {
		return domain.Endpoint{}, "", sharederrors.Wrap("webhooks.CreateEndpoint", err)
	}
	idem := Idempotency{Scope: "webhooks:" + in.CallerID.String(), Key: in.IdempotencyKey}
	stored, storedSealed, err := s.repo.CreateEndpoint(ctx, endpoint, sealed, idem)
	if err != nil {
		return domain.Endpoint{}, "", err
	}
	if stored.ID == endpoint.ID {
		return stored, secret, nil
	}
	// A replay: the row of the first call, whose secret is opened again.
	first, err := s.sealer.Open(stored.ID, storedSealed)
	if err != nil {
		return domain.Endpoint{}, "", sharederrors.Wrap("webhooks.CreateEndpoint", err)
	}
	return stored, first, nil
}

// GetEndpoint returns one endpoint.
func (s *Service) GetEndpoint(ctx context.Context, id ids.ID) (domain.Endpoint, error) {
	return s.repo.GetEndpoint(ctx, id)
}

// ListEndpoints returns one page of endpoints, newest first.
func (s *Service) ListEndpoints(ctx context.Context, pageSize int32, after *pagination.Cursor) (domain.EndpointPage, error) {
	return s.repo.ListEndpoints(ctx, int(pagination.ClampLimit(pageSize)), after)
}

// RotateEndpointSecret replaces the signing secret and returns the new one.
func (s *Service) RotateEndpointSecret(ctx context.Context, id ids.ID) (domain.Endpoint, string, error) {
	secret := domain.NewSecret()
	sealed, err := s.sealer.Seal(id, secret)
	if err != nil {
		return domain.Endpoint{}, "", sharederrors.Wrap("webhooks.RotateEndpointSecret", err)
	}
	endpoint, err := s.repo.RotateSecret(ctx, id, sealed, s.clock.Now())
	if err != nil {
		return domain.Endpoint{}, "", err
	}
	return endpoint, secret, nil
}

// DisableEndpoint stops deliveries to an endpoint.
func (s *Service) DisableEndpoint(ctx context.Context, id ids.ID) (domain.Endpoint, error) {
	return s.repo.DisableEndpoint(ctx, id, domain.DisabledByOperator, s.clock.Now())
}

// EnableEndpoint resumes deliveries and resets the failure counter.
func (s *Service) EnableEndpoint(ctx context.Context, id ids.ID) (domain.Endpoint, error) {
	return s.repo.EnableEndpoint(ctx, id, s.clock.Now())
}

// DeleteEndpoint removes an endpoint and its delivery log.
func (s *Service) DeleteEndpoint(ctx context.Context, id ids.ID) error {
	return s.repo.DeleteEndpoint(ctx, id)
}

// ListDeliveries returns one page of an endpoint's deliveries, newest first. An
// unknown endpoint is NotFound, not an empty page.
func (s *Service) ListDeliveries(ctx context.Context, endpointID ids.ID, pageSize int32, after *pagination.Cursor) (domain.DeliveryPage, error) {
	if _, err := s.repo.GetEndpoint(ctx, endpointID); err != nil {
		return domain.DeliveryPage{}, err
	}
	return s.repo.ListDeliveries(ctx, endpointID, int(pagination.ClampLimit(pageSize)), after)
}

// RedeliverDelivery queues a failed or cancelled delivery again. A delivery that
// is already pending is returned as it is, so retrying the call queues nothing twice.
func (s *Service) RedeliverDelivery(ctx context.Context, id ids.ID) (domain.Delivery, error) {
	delivery, requeued, err := s.repo.RequeueDelivery(ctx, id, s.clock.Now())
	if err != nil {
		return domain.Delivery{}, err
	}
	if !requeued {
		if err := delivery.CheckRedeliverable(); err != nil {
			return domain.Delivery{}, err
		}
	}
	return delivery, nil
}
