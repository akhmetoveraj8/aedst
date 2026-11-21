// Package transport implements the ConnectRPC handler of WebhooksService. It
// depends only on modules/webhooks/api. Who may call it is the role policy's
// business (the module's built-in Roles), not this handler's; the caller's id
// is read from the authenticated context only to scope an idempotency key.
package transport

import (
	"context"

	"connectrpc.com/connect/v2"

	webhooksv1 "github.com/aedst/server/gen/go/aedst/webhooks/v1"
	"github.com/aedst/server/internal/modules/webhooks/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/platform/idempotency"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// Handler serves WebhooksService.
type Handler struct {
	service api.Service
}

// NewHandler builds the handler over the module's service.
func NewHandler(service api.Service) *Handler { return &Handler{service: service} }

func (h *Handler) CreateEndpoint(ctx context.Context, req *webhooksv1.CreateEndpointRequest) (*webhooksv1.CreateEndpointResponse, error) {
	identity, ok := platformauth.FromContext(ctx)
	if !ok {
		// Unreachable in practice: no procedure of this service is public.
		return nil, httpserver.ToConnectError(sharederrors.Unauthorized("webhooks", "missing identity"))
	}
	key, _ := idempotency.KeyFromContext(ctx)
	endpoint, secret, err := h.service.CreateEndpoint(ctx, api.CreateEndpointInput{
		URL: req.GetUrl(), Description: req.GetDescription(), EventTypes: req.GetEventTypes(),
		IdempotencyKey: key, CallerID: identity.UserID,
	})
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &webhooksv1.CreateEndpointResponse{Endpoint: endpointToProto(endpoint), Secret: secret}, nil
}

func (h *Handler) GetEndpoint(ctx context.Context, req *webhooksv1.GetEndpointRequest) (*webhooksv1.GetEndpointResponse, error) {
	endpoint, err := withID(ctx, req.GetId(), h.service.GetEndpoint)
	if err != nil {
		return nil, err
	}
	return &webhooksv1.GetEndpointResponse{Endpoint: endpointToProto(endpoint)}, nil
}

func (h *Handler) ListEndpoints(ctx context.Context, req *webhooksv1.ListEndpointsRequest) (*webhooksv1.ListEndpointsResponse, error) {
	after, err := pagination.Decode(req.GetPageToken(), api.EndpointListOrder)
	if err != nil {
		return nil, httpserver.ToConnectError(sharederrors.Validation("webhooks.ListEndpoints", "invalid page token"))
	}
	page, err := h.service.ListEndpoints(ctx, req.GetPageSize(), after)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	out := &webhooksv1.ListEndpointsResponse{Endpoints: make([]*webhooksv1.Endpoint, len(page.Endpoints))}
	for i, e := range page.Endpoints {
		out.Endpoints[i] = endpointToProto(e)
	}
	if page.Next != nil {
		out.NextPageToken = page.Next.Encode()
	}
	return out, nil
}

func (h *Handler) RotateEndpointSecret(ctx context.Context, req *webhooksv1.RotateEndpointSecretRequest) (*webhooksv1.RotateEndpointSecretResponse, error) {
	id, err := parseID(req.GetId())
	if err != nil {
		return nil, err
	}
	endpoint, secret, svcErr := h.service.RotateEndpointSecret(ctx, id)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &webhooksv1.RotateEndpointSecretResponse{Endpoint: endpointToProto(endpoint), Secret: secret}, nil
}

func (h *Handler) DisableEndpoint(ctx context.Context, req *webhooksv1.DisableEndpointRequest) (*webhooksv1.DisableEndpointResponse, error) {
	endpoint, err := withID(ctx, req.GetId(), h.service.DisableEndpoint)
	if err != nil {
		return nil, err
	}
	return &webhooksv1.DisableEndpointResponse{Endpoint: endpointToProto(endpoint)}, nil
}

func (h *Handler) EnableEndpoint(ctx context.Context, req *webhooksv1.EnableEndpointRequest) (*webhooksv1.EnableEndpointResponse, error) {
	endpoint, err := withID(ctx, req.GetId(), h.service.EnableEndpoint)
	if err != nil {
		return nil, err
	}
	return &webhooksv1.EnableEndpointResponse{Endpoint: endpointToProto(endpoint)}, nil
}

func (h *Handler) DeleteEndpoint(ctx context.Context, req *webhooksv1.DeleteEndpointRequest) (*webhooksv1.DeleteEndpointResponse, error) {
	id, err := parseID(req.GetId())
	if err != nil {
		return nil, err
	}
	if svcErr := h.service.DeleteEndpoint(ctx, id); svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	return &webhooksv1.DeleteEndpointResponse{}, nil
}

func (h *Handler) ListDeliveries(ctx context.Context, req *webhooksv1.ListDeliveriesRequest) (*webhooksv1.ListDeliveriesResponse, error) {
	endpointID, err := parseID(req.GetEndpointId())
	if err != nil {
		return nil, err
	}
	after, decodeErr := pagination.Decode(req.GetPageToken(), api.DeliveryListOrder)
	if decodeErr != nil {
		return nil, httpserver.ToConnectError(sharederrors.Validation("webhooks.ListDeliveries", "invalid page token"))
	}
	page, svcErr := h.service.ListDeliveries(ctx, endpointID, req.GetPageSize(), after)
	if svcErr != nil {
		return nil, httpserver.ToConnectError(svcErr)
	}
	out := &webhooksv1.ListDeliveriesResponse{Deliveries: make([]*webhooksv1.Delivery, len(page.Deliveries))}
	for i, d := range page.Deliveries {
		out.Deliveries[i] = deliveryToProto(d)
	}
	if page.Next != nil {
		out.NextPageToken = page.Next.Encode()
	}
	return out, nil
}

func (h *Handler) RedeliverDelivery(ctx context.Context, req *webhooksv1.RedeliverDeliveryRequest) (*webhooksv1.RedeliverDeliveryResponse, error) {
	delivery, err := withID(ctx, req.GetId(), h.service.RedeliverDelivery)
	if err != nil {
		return nil, err
	}
	return &webhooksv1.RedeliverDeliveryResponse{Delivery: deliveryToProto(delivery)}, nil
}

// withID parses an id and runs a use case that takes only it; the error is
// already a Connect error.
func withID[T any](ctx context.Context, raw string, call func(context.Context, ids.ID) (T, error)) (T, error) {
	var zero T
	id, err := parseID(raw)
	if err != nil {
		return zero, err
	}
	out, svcErr := call(ctx, id)
	if svcErr != nil {
		return zero, httpserver.ToConnectError(svcErr)
	}
	return out, nil
}

func parseID(raw string) (ids.ID, error) {
	id, err := ids.Parse(raw)
	if err != nil {
		return ids.Nil, connect.NewError(connect.CodeInvalidArgument, err.Error()).WithCause(err)
	}
	return id, nil
}
