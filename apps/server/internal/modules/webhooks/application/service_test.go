package application_test

import (
	"context"
	"errors"
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/webhooks/application"
	"github.com/aedst/server/internal/modules/webhooks/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

var (
	now     = time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)
	offered = []string{"tasks.v1.TaskCompleted", "media.v1.MediaReady"}
)

// fakeSealer "seals" by prefixing the endpoint id, so a test can see which
// endpoint a sealed secret belongs to and that Open is given the same one.
type fakeSealer struct{ err error }

func (f fakeSealer) Seal(id ids.ID, secret string) ([]byte, error) {
	return []byte(id.String() + "|" + secret), f.err
}

func (f fakeSealer) Open(id ids.ID, sealed []byte) (string, error) {
	secret, ok := strings.CutPrefix(string(sealed), id.String()+"|")
	if !ok {
		return "", errors.New("sealed for another endpoint")
	}
	return secret, nil
}

// fakeRepo is an in-memory Repository that remembers idempotency keys.
type fakeRepo struct {
	application.Repository // unimplemented methods panic: a test touching one is wrong

	endpoints map[ids.ID]domain.Endpoint
	sealed    map[ids.ID][]byte
	byKey     map[string]ids.ID
	requeue   func() (domain.Delivery, bool, error)
	listLimit int
	rotatedAt time.Time
	disabled  domain.DisabledReason
}

func newRepo() *fakeRepo {
	return &fakeRepo{endpoints: map[ids.ID]domain.Endpoint{}, sealed: map[ids.ID][]byte{}, byKey: map[string]ids.ID{}}
}

func (f *fakeRepo) CreateEndpoint(_ context.Context, e domain.Endpoint, sealed []byte, idem application.Idempotency) (domain.Endpoint, []byte, error) {
	if first, ok := f.byKey[idem.Scope+"/"+idem.Key]; ok && idem.Key != "" {
		return f.endpoints[first], f.sealed[first], nil
	}
	f.endpoints[e.ID], f.sealed[e.ID] = e, sealed
	f.byKey[idem.Scope+"/"+idem.Key] = e.ID
	return e, sealed, nil
}

func (f *fakeRepo) GetEndpoint(_ context.Context, id ids.ID) (domain.Endpoint, error) {
	e, ok := f.endpoints[id]
	if !ok {
		return domain.Endpoint{}, sharederrors.NotFound("webhooks.GetEndpoint", "endpoint not found")
	}
	return e, nil
}

func (f *fakeRepo) RotateSecret(_ context.Context, id ids.ID, sealed []byte, at time.Time) (domain.Endpoint, error) {
	e, err := f.GetEndpoint(context.Background(), id)
	if err != nil {
		return domain.Endpoint{}, err
	}
	f.sealed[id], f.rotatedAt = sealed, at
	return e, nil
}

func (f *fakeRepo) DisableEndpoint(_ context.Context, id ids.ID, reason domain.DisabledReason, _ time.Time) (domain.Endpoint, error) {
	f.disabled = reason
	return f.endpoints[id], nil
}

func (f *fakeRepo) ListDeliveries(_ context.Context, _ ids.ID, limit int, _ *pagination.Cursor) (domain.DeliveryPage, error) {
	f.listLimit = limit
	return domain.DeliveryPage{}, nil
}

func (f *fakeRepo) RequeueDelivery(context.Context, ids.ID, time.Time) (domain.Delivery, bool, error) {
	return f.requeue()
}

func newService(repo *fakeRepo) *application.Service {
	return application.NewService(repo, fakeSealer{}, sharedtime.Fixed{At: now}, offered)
}

func input(key string, caller ids.ID) application.CreateEndpointInput {
	return application.CreateEndpointInput{
		URL: "https://hooks.example.com/in", Description: "billing", EventTypes: []string{"tasks.v1.TaskCompleted"},
		IdempotencyKey: key, CallerID: caller,
	}
}

func TestCreateEndpoint_ReturnsTheSecretAndStoresOnlyItsSealedForm(t *testing.T) {
	repo := newRepo()
	endpoint, secret, err := newService(repo).CreateEndpoint(context.Background(), input("", ids.New()))
	if err != nil {
		t.Fatalf("CreateEndpoint() = %v", err)
	}
	if !strings.HasPrefix(secret, "whsec_") {
		t.Fatalf("secret has no whsec_ prefix")
	}
	if endpoint.Status != domain.EndpointActive || !endpoint.CreatedAt.Equal(now) {
		t.Errorf("endpoint = %+v, want active and created at the clock's time", endpoint)
	}
	if got := string(repo.sealed[endpoint.ID]); got != endpoint.ID.String()+"|"+secret {
		t.Errorf("the repository got %q, want the secret sealed for this endpoint", got)
	}
}

func TestCreateEndpoint_ReplayReturnsTheFirstEndpointAndSecret(t *testing.T) {
	repo, caller := newRepo(), ids.New()
	svc := newService(repo)
	first, firstSecret, err := svc.CreateEndpoint(context.Background(), input("key-1", caller))
	if err != nil {
		t.Fatal(err)
	}
	again, againSecret, err := svc.CreateEndpoint(context.Background(), input("key-1", caller))
	if err != nil {
		t.Fatalf("replay = %v", err)
	}
	if again.ID != first.ID || againSecret != firstSecret {
		t.Errorf("replay returned endpoint %s, want the first one (%s) with the same secret", again.ID, first.ID)
	}
	if len(repo.endpoints) != 1 {
		t.Errorf("%d endpoints stored, want 1", len(repo.endpoints))
	}
	// The key is scoped to the caller: another operator with the same key creates their own.
	other, _, err := svc.CreateEndpoint(context.Background(), input("key-1", ids.New()))
	if err != nil || other.ID == first.ID {
		t.Errorf("another caller with the same key got %s, %v; want a new endpoint", other.ID, err)
	}
}

func TestCreateEndpoint_ValidatesBeforeStoring(t *testing.T) {
	repo := newRepo()
	in := input("", ids.New())
	in.EventTypes = []string{"billing.v1.Paid"}
	_, secret, err := newService(repo).CreateEndpoint(context.Background(), in)
	if sharederrors.KindOf(err) != sharederrors.KindValidation || secret != "" || len(repo.endpoints) != 0 {
		t.Fatalf("CreateEndpoint() = %q, %v with %d rows; want a validation error and nothing stored", secret, err, len(repo.endpoints))
	}
}

func TestCreateEndpoint_SealFailureStoresNothing(t *testing.T) {
	repo := newRepo()
	svc := application.NewService(repo, fakeSealer{err: errors.New("no key")}, sharedtime.Fixed{At: now}, offered)
	_, secret, err := svc.CreateEndpoint(context.Background(), input("", ids.New()))
	if err == nil || secret != "" || len(repo.endpoints) != 0 {
		t.Fatalf("CreateEndpoint() = %q, %v; want an error and nothing stored", secret, err)
	}
}

func TestRotateEndpointSecret(t *testing.T) {
	repo := newRepo()
	svc := newService(repo)
	endpoint, oldSecret, err := svc.CreateEndpoint(context.Background(), input("", ids.New()))
	if err != nil {
		t.Fatal(err)
	}
	_, newSecret, err := svc.RotateEndpointSecret(context.Background(), endpoint.ID)
	if err != nil || newSecret == oldSecret || !strings.HasPrefix(newSecret, "whsec_") {
		t.Fatalf("RotateEndpointSecret() = %v; want a different whsec_ secret", err)
	}
	if got := string(repo.sealed[endpoint.ID]); got != endpoint.ID.String()+"|"+newSecret || !repo.rotatedAt.Equal(now) {
		t.Errorf("the stored secret was not replaced by the new one at the clock's time")
	}
	if _, _, err := svc.RotateEndpointSecret(context.Background(), ids.New()); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Errorf("rotating an unknown endpoint = %v, want NotFound", err)
	}
}

func TestDisableEndpoint_RecordsTheOperatorAsTheReason(t *testing.T) {
	repo := newRepo()
	if _, err := newService(repo).DisableEndpoint(context.Background(), ids.New()); err != nil || repo.disabled != domain.DisabledByOperator {
		t.Fatalf("DisableEndpoint() = %v with reason %q, want %q", err, repo.disabled, domain.DisabledByOperator)
	}
}

func TestListDeliveries_UnknownEndpointIsNotFoundAndPageSizeIsClamped(t *testing.T) {
	repo := newRepo()
	svc := newService(repo)
	if _, err := svc.ListDeliveries(context.Background(), ids.New(), 10, nil); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("ListDeliveries(unknown endpoint) = %v, want NotFound", err)
	}
	endpoint, _, err := svc.CreateEndpoint(context.Background(), input("", ids.New()))
	if err != nil {
		t.Fatal(err)
	}
	for size, want := range map[int32]int{0: pagination.DefaultLimit, 50: 50, 1000: pagination.MaxLimit} {
		if _, err := svc.ListDeliveries(context.Background(), endpoint.ID, size, nil); err != nil || repo.listLimit != want {
			t.Errorf("page_size %d reached the repository as %d (%v), want %d", size, repo.listLimit, err, want)
		}
	}
}

func TestRedeliverDelivery(t *testing.T) {
	tests := []struct {
		name       string
		status     domain.DeliveryStatus
		requeued   bool
		wantReason string
	}{
		{"failed delivery is requeued", domain.DeliveryPending, true, ""},
		{"already pending: a retry of the call changes nothing", domain.DeliveryPending, false, ""},
		{"delivered cannot be redelivered", domain.DeliveryDelivered, false, "DELIVERY_ALREADY_DELIVERED"},
		{"endpoint disabled", domain.DeliveryFailed, false, "ENDPOINT_DISABLED"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			repo := newRepo()
			repo.requeue = func() (domain.Delivery, bool, error) { return domain.Delivery{Status: tt.status}, tt.requeued, nil }
			got, err := newService(repo).RedeliverDelivery(context.Background(), ids.New())
			if tt.wantReason == "" {
				if err != nil || got.Status != domain.DeliveryPending {
					t.Fatalf("RedeliverDelivery() = %+v, %v; want a pending delivery", got, err)
				}
				return
			}
			if sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition || sharederrors.ReasonOf(err) != tt.wantReason {
				t.Fatalf("RedeliverDelivery() = %v, want FailedPrecondition %s", err, tt.wantReason)
			}
		})
	}
	repo := newRepo()
	repo.requeue = func() (domain.Delivery, bool, error) {
		return domain.Delivery{}, false, sharederrors.NotFound("webhooks.RedeliverDelivery", "delivery not found")
	}
	if _, err := newService(repo).RedeliverDelivery(context.Background(), ids.New()); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("RedeliverDelivery(unknown) = %v, want NotFound", err)
	}
}

func TestDisabled_EveryUseCaseAnswersFailedPrecondition(t *testing.T) {
	var svc application.Disabled
	ctx, id := context.Background(), ids.New()
	_, _, create := svc.CreateEndpoint(ctx, application.CreateEndpointInput{})
	_, get := svc.GetEndpoint(ctx, id)
	_, list := svc.ListEndpoints(ctx, 0, nil)
	_, _, rotate := svc.RotateEndpointSecret(ctx, id)
	_, disable := svc.DisableEndpoint(ctx, id)
	_, enable := svc.EnableEndpoint(ctx, id)
	_, deliveries := svc.ListDeliveries(ctx, id, 0, nil)
	_, redeliver := svc.RedeliverDelivery(ctx, id)
	for i, err := range []error{create, get, list, rotate, disable, enable, svc.DeleteEndpoint(ctx, id), deliveries, redeliver} {
		if sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition || sharederrors.ReasonOf(err) != "WEBHOOKS_DISABLED" {
			t.Errorf("use case %d = %v, want FailedPrecondition WEBHOOKS_DISABLED", i, err)
		}
	}
}
