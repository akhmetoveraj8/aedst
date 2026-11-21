// Package api is the webhooks module's public boundary: the only package of
// modules/webhooks that its transport, cmd/server and other modules may import
// (enforced by architecturetest). It re-exports the vocabulary the transport
// needs, so the transport never imports the domain or the application.
package api

import (
	"context"

	"github.com/aedst/server/internal/modules/webhooks/application"
	"github.com/aedst/server/internal/modules/webhooks/domain"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

type (
	Endpoint            = domain.Endpoint
	EndpointStatus      = domain.EndpointStatus
	DisabledReason      = domain.DisabledReason
	Delivery            = domain.Delivery
	DeliveryStatus      = domain.DeliveryStatus
	EndpointPage        = domain.EndpointPage
	DeliveryPage        = domain.DeliveryPage
	CreateEndpointInput = application.CreateEndpointInput
)

const (
	EndpointActive     = domain.EndpointActive
	EndpointDisabled   = domain.EndpointDisabled
	DisabledByOperator = domain.DisabledByOperator
	DisabledByFailures = domain.DisabledByFailures
	DeliveryPending    = domain.DeliveryPending
	DeliveryDelivered  = domain.DeliveryDelivered
	DeliveryFailed     = domain.DeliveryFailed
	DeliveryCancelled  = domain.DeliveryCancelled

	EndpointListOrder = domain.EndpointListOrder
	DeliveryListOrder = domain.DeliveryListOrder
)

// Service is everything the operator API can do. A signing secret is returned
// by CreateEndpoint and RotateEndpointSecret only.
type Service interface {
	CreateEndpoint(ctx context.Context, in CreateEndpointInput) (endpoint Endpoint, secret string, err error)
	GetEndpoint(ctx context.Context, id ids.ID) (Endpoint, error)
	ListEndpoints(ctx context.Context, pageSize int32, after *pagination.Cursor) (EndpointPage, error)
	RotateEndpointSecret(ctx context.Context, id ids.ID) (endpoint Endpoint, secret string, err error)
	DisableEndpoint(ctx context.Context, id ids.ID) (Endpoint, error)
	EnableEndpoint(ctx context.Context, id ids.ID) (Endpoint, error)
	DeleteEndpoint(ctx context.Context, id ids.ID) error
	ListDeliveries(ctx context.Context, endpointID ids.ID, pageSize int32, after *pagination.Cursor) (DeliveryPage, error)
	RedeliverDelivery(ctx context.Context, id ids.ID) (Delivery, error)
}

var (
	_ Service = (*application.Service)(nil)
	_ Service = application.Disabled{}
)
