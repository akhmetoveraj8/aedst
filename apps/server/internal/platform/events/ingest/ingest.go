// Package ingest is both ends of event forwarding across a database boundary
// (apps/server/docs/adr/0022-event-forwarding-and-service-identity.md):
//
//   - Client is the events.Forwarder of the producer's process: it calls the
//     consumer service's EventIngestService with the service identity's token;
//   - Handler is that service's EventIngestService: it inserts the real delivery
//     job in its own database, idempotently on (consumer, event id).
//
// Neither end holds a transaction across the network: the producer's forward job
// and the consumer's delivery job are each committed in their own database and
// retried by their own River.
package ingest

import (
	"context"
	"errors"
	"fmt"
	"maps"
	"strings"
	"sync"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/aedst/server/gen/go/aedst/events/v1"
	eventsv1connect "github.com/aedst/server/gen/go/aedst/events/v1/eventsv1connect"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/platform/modulekit"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// TokenSource returns the bearer token of the service identity (serviceauth.TokenSource).
type TokenSource func(ctx context.Context) (string, error)

// Client forwards deliveries to the services that host their consumers.
type Client struct {
	urls    map[string]string
	token   TokenSource
	mu      sync.Mutex
	clients map[string]eventsv1connect.EventIngestServiceClient
	target  func(unit, url string) modulekit.RemoteTarget
}

var _ events.Forwarder = (*Client)(nil)

// NewClient builds the Forwarder for urls (AEDST_EVENTS_FORWARD: unit -> base URL).
// token may not be nil: a forward is a call with no user, so it needs the
// service identity.
func NewClient(urls map[string]string, token TokenSource) (*Client, error) {
	if token == nil {
		return nil, errors.New("ingest: event forwarding needs a service identity (set AEDST_SERVICE_IDENTITY_*)")
	}
	return &Client{
		urls: maps.Clone(urls), token: token, clients: map[string]eventsv1connect.EventIngestServiceClient{},
		target: func(unit, url string) modulekit.RemoteTarget {
			return modulekit.RemoteTarget{Name: "events-" + strings.ReplaceAll(unit, "/", "_"), BaseURL: url}
		},
	}, nil
}

// WithTarget replaces how a unit's RemoteTarget is built (tests inject an
// httptest client). It must be called before the first Forward.
func (c *Client) WithTarget(f func(unit, url string) modulekit.RemoteTarget) *Client {
	c.target = f
	return c
}

func (c *Client) clientFor(unit string) (eventsv1connect.EventIngestServiceClient, error) {
	c.mu.Lock()
	defer c.mu.Unlock()
	if cl, ok := c.clients[unit]; ok {
		return cl, nil
	}
	url, ok := c.urls[unit]
	if !ok {
		return nil, sharederrors.FailedPrecondition("events.forward", "no forward URL for unit "+unit+" (AEDST_EVENTS_FORWARD)")
	}
	cl := eventsv1connect.NewEventIngestServiceClient(modulekit.NewClient(c.target(unit, url)))
	c.clients[unit] = cl
	return cl, nil
}

// Forward implements events.Forwarder.
func (c *Client) Forward(ctx context.Context, unit string, d events.DeliveryArgs) error {
	cl, err := c.clientFor(unit)
	if err != nil {
		return err
	}
	tok, err := c.token(ctx)
	if err != nil {
		return sharederrors.Wrap("events.forward", err)
	}
	ctx = platformauth.WithBearer(ctx, tok)
	_, err = cl.Deliver(ctx, &eventsv1.DeliverRequest{
		Consumer: d.Consumer, EventId: d.EventID, EventType: d.EventType, EventVersion: d.EventVersion,
		OccurredAt: timestamppb.New(d.OccurredAt), PartitionKey: d.PartitionKey, Traceparent: d.Traceparent, Payload: d.Payload,
	})
	if err != nil {
		return modulekit.ErrorFromConnect("events.forward", err)
	}
	return nil
}

// Inserter is the part of the River client the handler needs: a non-transactional
// insert into this service's own database. Satisfied by *river.Client[pgx.Tx].
type Inserter interface {
	InsertMany(ctx context.Context, params []river.InsertManyParams) ([]*rivertype.JobInsertResult, error)
}

// Handler is the EventIngestService of the consumer's service.
type Handler struct {
	registry *events.Registry
	inserter Inserter
}

var _ eventsv1connect.EventIngestServiceHandler = (*Handler)(nil)

// NewHandler builds the ingest endpoint over registry (which consumers this
// process hosts) and the River client of this service's own database.
func NewHandler(registry *events.Registry, inserter Inserter) *Handler {
	return &Handler{registry: registry, inserter: inserter}
}

// Deliver inserts the delivery job. The unique key (consumer, event id) makes a
// replay a no-op: created is false then.
func (h *Handler) Deliver(ctx context.Context, req *eventsv1.DeliverRequest) (*eventsv1.DeliverResponse, error) {
	if !h.registry.Hosts(req.GetConsumer()) {
		return nil, httpserver.ToConnectError(sharederrors.NotFound("events.ingest", "no consumer "+req.GetConsumer()+" in this service"))
	}
	if got := h.registry.TypeOf(req.GetConsumer()); got != req.GetEventType() {
		return nil, httpserver.ToConnectError(sharederrors.Validation("events.ingest", fmt.Sprintf("consumer %s does not subscribe to %s", req.GetConsumer(), req.GetEventType())))
	}
	if _, err := ids.Parse(req.GetEventId()); err != nil {
		return nil, httpserver.ToConnectError(sharederrors.Validation("events.ingest", "event_id is not a valid id"))
	}
	if _, err := ids.Parse(req.GetPartitionKey()); err != nil {
		return nil, httpserver.ToConnectError(sharederrors.Validation("events.ingest", "partition_key is not a valid id"))
	}
	d := events.DeliveryArgs{
		Consumer: req.GetConsumer(), EventID: req.GetEventId(), EventType: req.GetEventType(), EventVersion: req.GetEventVersion(),
		OccurredAt: req.GetOccurredAt().AsTime(), PartitionKey: req.GetPartitionKey(), Traceparent: req.GetTraceparent(), Payload: req.GetPayload(),
	}
	res, err := h.inserter.InsertMany(ctx, []river.InsertManyParams{{Args: d}})
	if err != nil {
		return nil, httpserver.ToConnectError(sharederrors.Wrap("events.ingest", err))
	}
	created := len(res) == 1 && res[0] != nil && !res[0].UniqueSkippedAsDuplicate
	return &eventsv1.DeliverResponse{Created: created}, nil
}
