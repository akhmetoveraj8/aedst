package delivery_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/webhooks/domain"
	"github.com/aedst/server/internal/modules/webhooks/infrastructure/delivery"
	"github.com/aedst/server/internal/platform/webhooks"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

var now = time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)

type fakeOutcomes struct {
	got       []domain.Outcome
	threshold int
	at        time.Time
	err       error
}

func (f *fakeOutcomes) RecordOutcome(_ context.Context, o domain.Outcome, threshold int, at time.Time) error {
	f.got, f.threshold, f.at = append(f.got, o), threshold, at
	return f.err
}

func TestRecorder_MapsEveryResultToTheDeliveryLog(t *testing.T) {
	endpoint, event := ids.New(), ids.New()
	tests := []struct {
		result        webhooks.Result
		statusCode    int
		wantStatus    domain.DeliveryStatus
		wantSent      bool
		wantFailed    bool
		wantSucceeded bool
	}{
		{webhooks.ResultDelivered, 204, domain.DeliveryDelivered, true, false, true},
		{webhooks.ResultRetrying, 503, domain.DeliveryPending, true, false, false},
		{webhooks.ResultRejected, 410, domain.DeliveryFailed, true, true, false},
		{webhooks.ResultExhausted, 500, domain.DeliveryFailed, true, true, false},
		{webhooks.ResultCancelled, 0, domain.DeliveryCancelled, false, false, false},
	}
	for _, tt := range tests {
		t.Run(string(tt.result), func(t *testing.T) {
			store := &fakeOutcomes{}
			rec := delivery.NewRecorder(store, sharedtime.Fixed{At: now}, 5)
			err := rec.RecordAttempt(context.Background(), webhooks.Attempt{
				EndpointID: endpoint.String(), EventID: event.String(), Result: tt.result, StatusCode: tt.statusCode, Error: "why",
			})
			if err != nil || len(store.got) != 1 {
				t.Fatalf("RecordAttempt() = %v with %d outcomes, want one", err, len(store.got))
			}
			o := store.got[0]
			if o.EndpointID != endpoint || o.EventID != event || o.StatusCode != tt.statusCode || o.Error != "why" {
				t.Errorf("outcome = %+v, want the attempt's ids, status code and error", o)
			}
			if o.Status != tt.wantStatus || o.Sent != tt.wantSent || o.EndpointFailed != tt.wantFailed || o.EndpointSucceeded != tt.wantSucceeded {
				t.Errorf("outcome = %+v, want status %s sent=%v failed=%v succeeded=%v", o, tt.wantStatus, tt.wantSent, tt.wantFailed, tt.wantSucceeded)
			}
			if store.threshold != 5 || !store.at.Equal(now) {
				t.Errorf("threshold %d at %v, want 5 at the clock's time", store.threshold, store.at)
			}
		})
	}
}

func TestRecorder_StoreFailureIsReturnedAndForeignIDsAreSkipped(t *testing.T) {
	store := &fakeOutcomes{err: errors.New("db down")}
	rec := delivery.NewRecorder(store, sharedtime.Fixed{At: now}, 5)
	attempt := webhooks.Attempt{EndpointID: ids.New().String(), EventID: ids.New().String(), Result: webhooks.ResultDelivered}
	if err := rec.RecordAttempt(context.Background(), attempt); err == nil {
		t.Fatal("a store failure was swallowed: the worker could not retry the recording")
	}
	store = &fakeOutcomes{}
	rec = delivery.NewRecorder(store, sharedtime.Fixed{At: now}, 5)
	attempt.EndpointID = "not-a-uuid"
	if err := rec.RecordAttempt(context.Background(), attempt); err != nil || len(store.got) != 0 {
		t.Fatalf("RecordAttempt(foreign id) = %v with %d outcomes, want nil and none", err, len(store.got))
	}
	if _, err := delivery.OutcomeOf(webhooks.Attempt{EndpointID: ids.New().String(), EventID: ids.New().String(), Result: "bogus"}); err == nil {
		t.Fatal("an unknown result was mapped")
	}
}

type fakeSecrets struct {
	row   domain.SealedEndpoint
	found bool
	err   error
}

func (f fakeSecrets) GetEndpointSecret(context.Context, ids.ID) (domain.SealedEndpoint, bool, error) {
	return f.row, f.found, f.err
}

type fakeOpener struct {
	opened []ids.ID
	err    error
}

func (f *fakeOpener) Open(id ids.ID, sealed []byte) (string, error) {
	f.opened = append(f.opened, id)
	return "whsec_" + string(sealed), f.err
}

func TestEndpoints_GetEndpoint(t *testing.T) {
	id := ids.New()
	active := domain.SealedEndpoint{URL: "https://hooks.example.com/in", Active: true, Sealed: []byte("c2VjcmV0")}
	tests := []struct {
		name      string
		rawID     string
		secrets   fakeSecrets
		openErr   error
		want      webhooks.Endpoint
		wantFound bool
		wantErr   bool
		wantOpens int
	}{
		{
			"active endpoint is opened for signing", id.String(),
			fakeSecrets{row: active, found: true},
			nil,
			webhooks.Endpoint{ID: id.String(), URL: active.URL, Secret: "whsec_c2VjcmV0"},
			true, false, 1,
		},
		{
			"disabled endpoint: the secret is not opened", id.String(),
			fakeSecrets{row: domain.SealedEndpoint{URL: active.URL, Sealed: active.Sealed}, found: true},
			nil,
			webhooks.Endpoint{ID: id.String(), URL: active.URL, Disabled: true},
			true, false, 0,
		},
		{"deleted endpoint", id.String(), fakeSecrets{}, nil, webhooks.Endpoint{}, false, false, 0},
		{"malformed id is treated as deleted", "nope", fakeSecrets{row: active, found: true}, nil, webhooks.Endpoint{}, false, false, 0},
		{"store failure is retried", id.String(), fakeSecrets{err: errors.New("db down")}, nil, webhooks.Endpoint{}, false, true, 0},
		{"a secret that does not open is retried, not sent", id.String(), fakeSecrets{row: active, found: true}, errors.New("no key"), webhooks.Endpoint{}, false, true, 1},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			opener := &fakeOpener{err: tt.openErr}
			got, found, err := delivery.NewEndpoints(tt.secrets, opener).GetEndpoint(context.Background(), tt.rawID)
			if got != tt.want || found != tt.wantFound || (err != nil) != tt.wantErr {
				t.Fatalf("GetEndpoint() = %+v, %v, %v; want %+v, %v, err=%v", got.URL, found, err, tt.want.URL, tt.wantFound, tt.wantErr)
			}
			if len(opener.opened) != tt.wantOpens {
				t.Errorf("the secret was opened %d times, want %d", len(opener.opened), tt.wantOpens)
			}
		})
	}
	if _, found, err := (delivery.NoEndpoints{}).GetEndpoint(context.Background(), id.String()); found || err != nil {
		t.Fatalf("NoEndpoints.GetEndpoint() = %v, %v; want not found", found, err)
	}
}
