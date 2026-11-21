// Package delivery adapts the module's storage to the delivery worker of
// internal/platform/webhooks: the EndpointStore the worker loads an endpoint
// from (the only place a signing secret is opened for signing) and the Recorder
// that turns every attempt into a delivery-log entry and into the endpoint's
// failure counter.
package delivery

import (
	"context"
	"fmt"
	"time"

	"github.com/aedst/server/internal/modules/webhooks/domain"
	"github.com/aedst/server/internal/platform/webhooks"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// SecretStore loads an endpoint with its sealed secret (the postgres repository).
type SecretStore interface {
	GetEndpointSecret(ctx context.Context, id ids.ID) (secret domain.SealedEndpoint, found bool, err error)
}

// Opener opens a sealed signing secret (secretbox.Box).
type Opener interface {
	Open(endpointID ids.ID, sealed []byte) (string, error)
}

// Endpoints is the worker's webhooks.EndpointStore.
type Endpoints struct {
	store  SecretStore
	opener Opener
}

var _ webhooks.EndpointStore = Endpoints{}

// NewEndpoints builds the store over the jobs-pool repository.
func NewEndpoints(store SecretStore, opener Opener) Endpoints {
	return Endpoints{store: store, opener: opener}
}

// GetEndpoint loads the endpoint and opens its secret. A malformed id is
// "not found" (the job is cancelled); a secret that does not open is an error
// (the job is retried: the key may be restored).
func (e Endpoints) GetEndpoint(ctx context.Context, rawID string) (webhooks.Endpoint, bool, error) {
	id, err := ids.Parse(rawID)
	if err != nil {
		return webhooks.Endpoint{}, false, nil //nolint:nilerr // an id this module never issued: no such endpoint, the job is cancelled
	}
	row, found, err := e.store.GetEndpointSecret(ctx, id)
	if err != nil || !found {
		return webhooks.Endpoint{}, false, err
	}
	if !row.Active {
		return webhooks.Endpoint{ID: rawID, URL: row.URL, Disabled: true}, true, nil
	}
	secret, err := e.opener.Open(id, row.Sealed)
	if err != nil {
		return webhooks.Endpoint{}, false, fmt.Errorf("webhooks: endpoint %s: %w", rawID, err)
	}
	return webhooks.Endpoint{ID: rawID, URL: row.URL, Secret: secret}, true, nil
}

// NoEndpoints is the store of a deployment without AEDST_WEBHOOKS_ENABLED: every
// endpoint is "deleted", so a job left in the queue is cancelled, not sent.
type NoEndpoints struct{}

// GetEndpoint reports that the endpoint does not exist.
func (NoEndpoints) GetEndpoint(context.Context, string) (webhooks.Endpoint, bool, error) {
	return webhooks.Endpoint{}, false, nil
}

// OutcomeStore writes an attempt's outcome (the postgres repository).
type OutcomeStore interface {
	RecordOutcome(ctx context.Context, outcome domain.Outcome, threshold int, now time.Time) error
}

// Recorder is the worker's webhooks.Recorder.
type Recorder struct {
	store     OutcomeStore
	clock     sharedtime.Clock
	threshold int
}

var _ webhooks.Recorder = Recorder{}

// NewRecorder builds the recorder. threshold is the number of failed deliveries
// in a row after which an endpoint is disabled.
func NewRecorder(store OutcomeStore, clock sharedtime.Clock, threshold int) Recorder {
	return Recorder{store: store, clock: clock, threshold: threshold}
}

// RecordAttempt stores the outcome of one attempt.
func (r Recorder) RecordAttempt(ctx context.Context, a webhooks.Attempt) error {
	outcome, err := OutcomeOf(a)
	if err != nil {
		return nil //nolint:nilerr // ids the module did not issue: there is no row to update, and retrying cannot fix it
	}
	return r.store.RecordOutcome(ctx, outcome, r.threshold, r.clock.Now())
}

// OutcomeOf maps the worker's result to the delivery log:
//
//	delivered  -> delivered, the endpoint's failure counter is reset
//	retrying   -> pending (River will try again)
//	rejected   -> failed, counts as an endpoint failure
//	exhausted  -> failed, counts as an endpoint failure
//	cancelled  -> cancelled (nothing was sent; says nothing about the receiver)
func OutcomeOf(a webhooks.Attempt) (domain.Outcome, error) {
	endpointID, err := ids.Parse(a.EndpointID)
	if err != nil {
		return domain.Outcome{}, fmt.Errorf("webhooks: endpoint id: %w", err)
	}
	eventID, err := ids.Parse(a.EventID)
	if err != nil {
		return domain.Outcome{}, fmt.Errorf("webhooks: event id: %w", err)
	}
	o := domain.Outcome{EndpointID: endpointID, EventID: eventID, Sent: a.Sent(), StatusCode: a.StatusCode, Error: a.Error}
	switch a.Result {
	case webhooks.ResultDelivered:
		o.Status, o.EndpointSucceeded = domain.DeliveryDelivered, true
	case webhooks.ResultRetrying:
		o.Status = domain.DeliveryPending
	case webhooks.ResultRejected, webhooks.ResultExhausted:
		o.Status, o.EndpointFailed = domain.DeliveryFailed, true
	case webhooks.ResultCancelled:
		o.Status = domain.DeliveryCancelled
	default:
		return domain.Outcome{}, fmt.Errorf("webhooks: unknown attempt result %q", a.Result)
	}
	return o, nil
}
