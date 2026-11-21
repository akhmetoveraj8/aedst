//go:build integration

// Integration tests against a real PostgreSQL: the endpoint registry, the
// idempotent fan-out insert and the worker's outcome recording, dead-letter
// state included. They need Docker or AEDST_TEST_DATABASE_URL.
package postgres_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aedst/server/internal/modules/webhooks/application"
	"github.com/aedst/server/internal/modules/webhooks/domain"
	"github.com/aedst/server/internal/modules/webhooks/infrastructure/postgres"
	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/postgrestest"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

const eventType = "tasks.v1.TaskCompleted"

var t0 = time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)

func createEndpoint(t *testing.T, repo *postgres.Repository, at time.Time) domain.Endpoint {
	t.Helper()
	e, err := domain.NewEndpoint(ids.New(), "https://hooks.example.com/in", "", []string{eventType}, []string{eventType}, at)
	if err != nil {
		t.Fatal(err)
	}
	stored, sealed, err := repo.CreateEndpoint(context.Background(), e, []byte("sealed"), application.Idempotency{})
	if err != nil || string(sealed) != "sealed" {
		t.Fatalf("CreateEndpoint() = %q, %v", sealed, err)
	}
	return stored
}

// fanOut inserts the deliveries of one event the way the event consumer does.
func fanOut(t *testing.T, pool *pgxpool.Pool, repo *postgres.Repository, eventID ids.ID) []ids.ID {
	t.Helper()
	var inserted []ids.ID
	err := database.WithTx(context.Background(), pool, func(ctx context.Context, tx pgx.Tx) error {
		endpoints, err := repo.SubscribedEndpointIDs(ctx, tx, eventType)
		if err != nil {
			return err
		}
		inserted, err = repo.InsertDeliveries(ctx, tx, eventID, eventType, []byte(`{"task_id":"t-1"}`), endpoints, t0)
		return err
	})
	if err != nil {
		t.Fatal(err)
	}
	return inserted
}

func TestRepository_EndpointLifecycleAndKeysetList(t *testing.T) {
	pool := postgrestest.NewPool(t, "webhooks")
	repo := postgres.NewRepository(pool, nil)
	ctx := context.Background()
	var all []domain.Endpoint
	for i := range 3 {
		all = append(all, createEndpoint(t, repo, t0.Add(time.Duration(i)*time.Second)))
	}
	page, err := repo.ListEndpoints(ctx, 2, nil)
	if err != nil || len(page.Endpoints) != 2 || page.Next == nil || page.Endpoints[0].ID != all[2].ID {
		t.Fatalf("first page = %+v, %v; want the two newest and a cursor", page, err)
	}
	rest, err := repo.ListEndpoints(ctx, 2, page.Next)
	if err != nil || len(rest.Endpoints) != 1 || rest.Next != nil || rest.Endpoints[0].ID != all[0].ID {
		t.Fatalf("second page = %+v, %v; want the oldest and no cursor", rest, err)
	}

	id := all[0].ID
	disabled, err := repo.DisableEndpoint(ctx, id, domain.DisabledByOperator, t0)
	if err != nil || disabled.Status != domain.EndpointDisabled || disabled.DisabledReason != domain.DisabledByOperator {
		t.Fatalf("DisableEndpoint() = %+v, %v", disabled, err)
	}
	if again, err := repo.DisableEndpoint(ctx, id, domain.DisabledByOperator, t0); err != nil || again.Status != domain.EndpointDisabled {
		t.Fatalf("disabling twice = %+v, %v; want the same state", again, err)
	}
	enabled, err := repo.EnableEndpoint(ctx, id, t0)
	if err != nil || enabled.Status != domain.EndpointActive || enabled.DisabledReason != domain.DisabledNone {
		t.Fatalf("EnableEndpoint() = %+v, %v", enabled, err)
	}
	if _, err := repo.RotateSecret(ctx, id, []byte("sealed-2"), t0); err != nil {
		t.Fatal(err)
	}
	if secret, found, err := repo.GetEndpointSecret(ctx, id); err != nil || !found || string(secret.Sealed) != "sealed-2" || !secret.Active {
		t.Fatalf("GetEndpointSecret() = %+v, %v, %v", secret, found, err)
	}
	if err := repo.DeleteEndpoint(ctx, id); err != nil {
		t.Fatal(err)
	}
	if err := repo.DeleteEndpoint(ctx, id); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("deleting twice = %v, want NotFound", err)
	}
	if _, found, err := repo.GetEndpointSecret(ctx, id); found || err != nil {
		t.Fatalf("a deleted endpoint is still found (%v)", err)
	}
}

func TestRepository_FanOutIsIdempotentAndSkipsDisabledEndpoints(t *testing.T) {
	pool := postgrestest.NewPool(t, "webhooks")
	repo := postgres.NewRepository(pool, nil)
	ctx := context.Background()
	a, b := createEndpoint(t, repo, t0), createEndpoint(t, repo, t0)
	if _, err := repo.DisableEndpoint(ctx, b.ID, domain.DisabledByOperator, t0); err != nil {
		t.Fatal(err)
	}
	eventID := ids.New()
	if got := fanOut(t, pool, repo, eventID); len(got) != 1 || got[0] != a.ID {
		t.Fatalf("fan-out inserted for %v, want only the active endpoint", got)
	}
	if got := fanOut(t, pool, repo, eventID); len(got) != 0 {
		t.Fatalf("a redelivered event inserted %d more deliveries, want 0", len(got))
	}
	page, err := repo.ListDeliveries(ctx, a.ID, 10, nil)
	if err != nil || len(page.Deliveries) != 1 || page.Deliveries[0].Status != domain.DeliveryPending || page.Deliveries[0].EventID != eventID {
		t.Fatalf("ListDeliveries() = %+v, %v; want one pending delivery of the event", page, err)
	}
}

func TestRepository_RecordOutcomeDisablesAfterConsecutiveFailures(t *testing.T) {
	pool := postgrestest.NewPool(t, "webhooks")
	repo := postgres.NewRepository(pool, nil)
	ctx := context.Background()
	e := createEndpoint(t, repo, t0)
	record := func(status domain.DeliveryStatus, failed, succeeded bool) {
		t.Helper()
		eventID := ids.New()
		fanOut(t, pool, repo, eventID)
		o := domain.Outcome{EndpointID: e.ID, EventID: eventID, Status: status, Sent: true, StatusCode: 500, Error: "receiver answered 500", EndpointFailed: failed, EndpointSucceeded: succeeded}
		if err := repo.RecordOutcome(ctx, o, 3, t0.Add(time.Minute)); err != nil {
			t.Fatal(err)
		}
	}
	record(domain.DeliveryFailed, true, false)
	record(domain.DeliveryFailed, true, false)
	record(domain.DeliveryDelivered, false, true) // a success resets the counter
	if got, _ := repo.GetEndpoint(ctx, e.ID); got.ConsecutiveFailures != 0 || got.Status != domain.EndpointActive {
		t.Fatalf("after a success: %+v, want 0 failures and active", got)
	}
	for range 3 {
		record(domain.DeliveryFailed, true, false)
	}
	got, err := repo.GetEndpoint(ctx, e.ID)
	if err != nil || got.Status != domain.EndpointDisabled || got.DisabledReason != domain.DisabledByFailures || got.ConsecutiveFailures != 3 {
		t.Fatalf("after 3 failures in a row: %+v, %v; want disabled by consecutive_failures", got, err)
	}
	page, err := repo.ListDeliveries(ctx, e.ID, 10, nil)
	if err != nil || len(page.Deliveries) != 6 {
		t.Fatalf("ListDeliveries() = %d rows, %v; want 6", len(page.Deliveries), err)
	}
	newest := page.Deliveries[0]
	if newest.Attempts != 1 || newest.LastStatusCode != 500 || newest.LastError == "" {
		t.Errorf("recorded delivery = %+v, want one attempt with its status code and error", newest)
	}
	// An outcome for a delivery retention already purged is not an error.
	if n, err := repo.PurgeDeliveries(ctx, t0.Add(time.Hour), 100); err != nil || n != 6 {
		t.Fatalf("PurgeDeliveries() = %d, %v; want 6", n, err)
	}
	if err := repo.RecordOutcome(ctx, domain.Outcome{EndpointID: e.ID, EventID: ids.New(), Status: domain.DeliveryCancelled}, 3, t0); err != nil {
		t.Fatalf("RecordOutcome(purged row) = %v, want nil", err)
	}
}
