package transport_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"connectrpc.com/connect/v2"
	"google.golang.org/protobuf/encoding/protojson"

	webhooksv1 "github.com/aedst/server/gen/go/aedst/webhooks/v1"
	"github.com/aedst/server/internal/modules/webhooks/api"
	"github.com/aedst/server/internal/modules/webhooks/transport"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/idempotency"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

const secret = "whsec_c2VjcmV0LXNlY3JldC1zZWNyZXQtc2VjcmV0"

var now = time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)

// fakeService returns canned results and records what the handler passed down.
type fakeService struct {
	api.Service // unimplemented methods panic: a test touching one is wrong

	err      error
	endpoint api.Endpoint
	delivery api.Delivery
	created  api.CreateEndpointInput
	after    *pagination.Cursor
	next     *pagination.Cursor
}

func (f *fakeService) CreateEndpoint(_ context.Context, in api.CreateEndpointInput) (api.Endpoint, string, error) {
	f.created = in
	return f.endpoint, secret, f.err
}

func (f *fakeService) GetEndpoint(context.Context, ids.ID) (api.Endpoint, error) {
	return f.endpoint, f.err
}

func (f *fakeService) ListEndpoints(_ context.Context, _ int32, after *pagination.Cursor) (api.EndpointPage, error) {
	f.after = after
	return api.EndpointPage{Endpoints: []api.Endpoint{f.endpoint}, Next: f.next}, f.err
}

func (f *fakeService) RotateEndpointSecret(context.Context, ids.ID) (api.Endpoint, string, error) {
	return f.endpoint, secret, f.err
}

func (f *fakeService) DisableEndpoint(context.Context, ids.ID) (api.Endpoint, error) {
	return f.endpoint, f.err
}

func (f *fakeService) EnableEndpoint(context.Context, ids.ID) (api.Endpoint, error) {
	return f.endpoint, f.err
}
func (f *fakeService) DeleteEndpoint(context.Context, ids.ID) error { return f.err }

func (f *fakeService) ListDeliveries(_ context.Context, _ ids.ID, _ int32, after *pagination.Cursor) (api.DeliveryPage, error) {
	f.after = after
	return api.DeliveryPage{Deliveries: []api.Delivery{f.delivery}, Next: f.next}, f.err
}

func (f *fakeService) RedeliverDelivery(context.Context, ids.ID) (api.Delivery, error) {
	return f.delivery, f.err
}

func endpoint() api.Endpoint {
	return api.Endpoint{
		ID: ids.New(), URL: "https://hooks.example.com/in", Description: "billing", EventTypes: []string{"tasks.v1.TaskCompleted"},
		Status: api.EndpointDisabled, DisabledReason: api.DisabledByFailures, ConsecutiveFailures: 5, CreatedAt: now, UpdatedAt: now,
	}
}

func codeOf(err error) connect.Code {
	if ce, ok := errors.AsType[*connect.Error](err); ok {
		return ce.Code()
	}
	return 0
}

// calls runs every RPC that takes one id (or a create) against h and returns
// the errors by RPC name.
func calls(ctx context.Context, h *transport.Handler, id string) map[string]error {
	out := map[string]error{}
	_, out["CreateEndpoint"] = h.CreateEndpoint(ctx, &webhooksv1.CreateEndpointRequest{Url: "https://hooks.example.com/in", EventTypes: []string{"tasks.v1.TaskCompleted"}})
	_, out["GetEndpoint"] = h.GetEndpoint(ctx, &webhooksv1.GetEndpointRequest{Id: id})
	_, out["ListEndpoints"] = h.ListEndpoints(ctx, &webhooksv1.ListEndpointsRequest{})
	_, out["RotateEndpointSecret"] = h.RotateEndpointSecret(ctx, &webhooksv1.RotateEndpointSecretRequest{Id: id})
	_, out["DisableEndpoint"] = h.DisableEndpoint(ctx, &webhooksv1.DisableEndpointRequest{Id: id})
	_, out["EnableEndpoint"] = h.EnableEndpoint(ctx, &webhooksv1.EnableEndpointRequest{Id: id})
	_, out["DeleteEndpoint"] = h.DeleteEndpoint(ctx, &webhooksv1.DeleteEndpointRequest{Id: id})
	_, out["ListDeliveries"] = h.ListDeliveries(ctx, &webhooksv1.ListDeliveriesRequest{EndpointId: id})
	_, out["RedeliverDelivery"] = h.RedeliverDelivery(ctx, &webhooksv1.RedeliverDeliveryRequest{Id: id})
	return out
}

func authed(user ids.ID) context.Context {
	return platformauth.WithIdentity(context.Background(), platformauth.Identity{UserID: user})
}

func TestHandler_MapsDomainErrorsToConnectCodes(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want connect.Code
	}{
		{"not found", sharederrors.NotFound("webhooks", "endpoint not found"), connect.CodeNotFound},
		{"validation", sharederrors.Validation("webhooks", "url must use https"), connect.CodeInvalidArgument},
		{"disabled module", sharederrors.FailedPrecondition("webhooks", "webhooks are disabled").WithReason("WEBHOOKS_DISABLED"), connect.CodeFailedPrecondition},
		{"idempotency key reused", sharederrors.Conflict("idempotency.Check", "key reused").WithReason("IDEMPOTENCY_KEY_REUSED"), connect.CodeAborted},
		{"unclassified failure stays generic", errors.New("pq: connection refused at 10.0.0.5 with whsec_leak"), connect.CodeInternal},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			h := transport.NewHandler(&fakeService{err: tt.err})
			for rpc, err := range calls(authed(ids.New()), h, ids.New().String()) {
				if got := codeOf(err); got != tt.want {
					t.Errorf("%s: code = %v, want %v", rpc, got, tt.want)
				}
				if tt.want == connect.CodeInternal && (strings.Contains(err.Error(), "10.0.0.5") || strings.Contains(err.Error(), "whsec_")) {
					t.Errorf("%s: an internal error leaked its cause: %v", rpc, err)
				}
			}
		})
	}
}

func TestHandler_MalformedIDsAndTokensAreInvalidArgument(t *testing.T) {
	h := transport.NewHandler(&fakeService{})
	for rpc, err := range calls(authed(ids.New()), h, "not-a-uuid") {
		if rpc == "CreateEndpoint" || rpc == "ListEndpoints" {
			continue // take no id
		}
		if got := codeOf(err); got != connect.CodeInvalidArgument {
			t.Errorf("%s with a malformed id: code = %v, want InvalidArgument", rpc, got)
		}
	}
	_, err := h.ListEndpoints(context.Background(), &webhooksv1.ListEndpointsRequest{PageToken: "garbage"})
	if codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("ListEndpoints with a garbage token = %v, want InvalidArgument", err)
	}
	// A token minted for the endpoint list is refused by the delivery list.
	foreign := pagination.Cursor{Sort: api.EndpointListOrder, Key: now, ID: ids.New()}.Encode()
	_, err = h.ListDeliveries(context.Background(), &webhooksv1.ListDeliveriesRequest{EndpointId: ids.New().String(), PageToken: foreign})
	if codeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("ListDeliveries with another list's token = %v, want InvalidArgument", err)
	}
}

func TestCreateEndpoint_PassesTheCallerAndTheIdempotencyKey(t *testing.T) {
	svc := &fakeService{endpoint: endpoint()}
	h := transport.NewHandler(svc)
	caller := ids.New()
	ctx := idempotency.WithKey(authed(caller), "key-1")
	resp, err := h.CreateEndpoint(ctx, &webhooksv1.CreateEndpointRequest{Url: "https://hooks.example.com/in", Description: "billing", EventTypes: []string{"tasks.v1.TaskCompleted"}})
	if err != nil {
		t.Fatalf("CreateEndpoint() = %v", err)
	}
	if svc.created.CallerID != caller || svc.created.IdempotencyKey != "key-1" || svc.created.URL != "https://hooks.example.com/in" {
		t.Errorf("service got %+v, want the caller from the token and the header's key", svc.created)
	}
	if resp.GetSecret() != secret {
		t.Errorf("the create response does not carry the secret")
	}
	if _, err := h.CreateEndpoint(context.Background(), &webhooksv1.CreateEndpointRequest{}); codeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("CreateEndpoint without an identity = %v, want Unauthenticated", err)
	}
}

func TestHandler_OnlyCreateAndRotateCarryTheSecret(t *testing.T) {
	svc := &fakeService{endpoint: endpoint(), delivery: api.Delivery{ID: ids.New(), Status: api.DeliveryFailed, LastError: "receiver answered 500"}}
	h := transport.NewHandler(svc)
	ctx, id := authed(ids.New()), ids.New().String()

	create, _ := h.CreateEndpoint(ctx, &webhooksv1.CreateEndpointRequest{})
	rotate, _ := h.RotateEndpointSecret(ctx, &webhooksv1.RotateEndpointSecretRequest{Id: id})
	if create.GetSecret() != secret || rotate.GetSecret() != secret {
		t.Fatal("create and rotate must return the secret")
	}
	get, _ := h.GetEndpoint(ctx, &webhooksv1.GetEndpointRequest{Id: id})
	list, _ := h.ListEndpoints(ctx, &webhooksv1.ListEndpointsRequest{})
	disable, _ := h.DisableEndpoint(ctx, &webhooksv1.DisableEndpointRequest{Id: id})
	enable, _ := h.EnableEndpoint(ctx, &webhooksv1.EnableEndpointRequest{Id: id})
	deliveries, _ := h.ListDeliveries(ctx, &webhooksv1.ListDeliveriesRequest{EndpointId: id})
	redeliver, _ := h.RedeliverDelivery(ctx, &webhooksv1.RedeliverDeliveryRequest{Id: id})
	for _, body := range []string{
		protojson.Format(get), protojson.Format(list), protojson.Format(disable), protojson.Format(enable),
		protojson.Format(deliveries), protojson.Format(redeliver), protojson.Format(create.GetEndpoint()), protojson.Format(rotate.GetEndpoint()),
	} {
		if strings.Contains(body, "whsec_") || strings.Contains(strings.ToLower(body), "secret") {
			t.Errorf("a response other than create/rotate mentions a secret: %s", body)
		}
	}
}

func TestHandler_MapsEnumsTimestampsAndPageTokens(t *testing.T) {
	deliveredAt := now.Add(time.Minute)
	next := pagination.Cursor{Sort: api.DeliveryListOrder, Key: now, ID: ids.New()}
	svc := &fakeService{
		endpoint: endpoint(),
		delivery: api.Delivery{ID: ids.New(), EndpointID: ids.New(), EventID: ids.New(), EventType: "tasks.v1.TaskCompleted", Status: api.DeliveryDelivered, Attempts: 2, LastStatusCode: 204, CreatedAt: now, UpdatedAt: deliveredAt, DeliveredAt: &deliveredAt},
		next:     &next,
	}
	h := transport.NewHandler(svc)
	get, err := h.GetEndpoint(context.Background(), &webhooksv1.GetEndpointRequest{Id: ids.New().String()})
	if err != nil {
		t.Fatal(err)
	}
	e := get.GetEndpoint()
	if e.GetStatus() != webhooksv1.EndpointStatus_ENDPOINT_STATUS_DISABLED ||
		e.GetDisabledReason() != webhooksv1.EndpointDisabledReason_ENDPOINT_DISABLED_REASON_CONSECUTIVE_FAILURES ||
		e.GetConsecutiveFailures() != 5 || !e.GetCreatedAt().AsTime().Equal(now) {
		t.Errorf("endpoint message = %v", e)
	}
	token := next.Encode()
	list, err := h.ListDeliveries(context.Background(), &webhooksv1.ListDeliveriesRequest{EndpointId: ids.New().String(), PageToken: token})
	if err != nil {
		t.Fatal(err)
	}
	if svc.after == nil || svc.after.ID != next.ID {
		t.Errorf("the page token was not decoded into the cursor: %+v", svc.after)
	}
	d := list.GetDeliveries()[0]
	if list.GetNextPageToken() != token || d.GetStatus() != webhooksv1.DeliveryStatus_DELIVERY_STATUS_DELIVERED ||
		d.GetAttempts() != 2 || d.GetLastStatusCode() != 204 || !d.GetDeliveredAt().AsTime().Equal(deliveredAt) {
		t.Errorf("delivery page = %v", list)
	}
	svc.delivery.DeliveredAt, svc.next = nil, nil
	list, _ = h.ListDeliveries(context.Background(), &webhooksv1.ListDeliveriesRequest{EndpointId: ids.New().String()})
	if list.GetNextPageToken() != "" || list.GetDeliveries()[0].GetDeliveredAt() != nil {
		t.Errorf("last page of undelivered rows = %v, want no token and no delivered_at", list)
	}
}
