package application

import (
	"context"

	"github.com/aedst/server/internal/modules/webhooks/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// Disabled is the service of a deployment without AEDST_WEBHOOKS_ENABLED: every
// use case answers FAILED_PRECONDITION and touches nothing.
type Disabled struct{}

func errDisabled() error {
	return sharederrors.FailedPrecondition("webhooks", "webhooks are disabled on this server").WithReason("WEBHOOKS_DISABLED")
}

func (Disabled) CreateEndpoint(context.Context, CreateEndpointInput) (domain.Endpoint, string, error) {
	return domain.Endpoint{}, "", errDisabled()
}

func (Disabled) GetEndpoint(context.Context, ids.ID) (domain.Endpoint, error) {
	return domain.Endpoint{}, errDisabled()
}

func (Disabled) ListEndpoints(context.Context, int32, *pagination.Cursor) (domain.EndpointPage, error) {
	return domain.EndpointPage{}, errDisabled()
}

func (Disabled) RotateEndpointSecret(context.Context, ids.ID) (domain.Endpoint, string, error) {
	return domain.Endpoint{}, "", errDisabled()
}

func (Disabled) DisableEndpoint(context.Context, ids.ID) (domain.Endpoint, error) {
	return domain.Endpoint{}, errDisabled()
}

func (Disabled) EnableEndpoint(context.Context, ids.ID) (domain.Endpoint, error) {
	return domain.Endpoint{}, errDisabled()
}

func (Disabled) DeleteEndpoint(context.Context, ids.ID) error { return errDisabled() }

func (Disabled) ListDeliveries(context.Context, ids.ID, int32, *pagination.Cursor) (domain.DeliveryPage, error) {
	return domain.DeliveryPage{}, errDisabled()
}

func (Disabled) RedeliverDelivery(context.Context, ids.ID) (domain.Delivery, error) {
	return domain.Delivery{}, errDisabled()
}
