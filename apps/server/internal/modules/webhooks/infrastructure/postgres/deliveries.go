package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"

	webhooksdb "github.com/aedst/server/gen/db/webhooks"
	"github.com/aedst/server/internal/modules/webhooks/domain"
	"github.com/aedst/server/internal/platform/database"
	platformwebhooks "github.com/aedst/server/internal/platform/webhooks"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// maxFanOutEndpoints bounds how many endpoints one event is fanned out to.
// Endpoints are registered by operators, so the bound is a guard, not a quota.
const maxFanOutEndpoints = 1000

func (r *Repository) ListDeliveries(ctx context.Context, endpointID ids.ID, limit int, after *pagination.Cursor) (domain.DeliveryPage, error) {
	key, id := cursor(after)
	rows, err := webhooksdb.New(r.pool).ListDeliveries(ctx, webhooksdb.ListDeliveriesParams{
		EndpointID: uuid(endpointID), CursorKey: key, CursorID: id, PageLimit: int32(limit) + 1,
	})
	if err != nil {
		return domain.DeliveryPage{}, sharederrors.Wrap("webhooks.ListDeliveries", err)
	}
	items := make([]domain.Delivery, len(rows))
	for i, row := range rows {
		items[i] = deliveryFromRow(webhooksdb.GetDeliveryRow(row))
	}
	page := pagination.NewPage(items, limit, func(d domain.Delivery) pagination.Cursor {
		return pagination.Cursor{Sort: domain.DeliveryListOrder, Key: d.CreatedAt, ID: d.ID}
	})
	return domain.DeliveryPage{Deliveries: page.Items, Next: page.Next}, nil
}

// RequeueDelivery is the guarded transition behind RedeliverDelivery: the status
// change and the new job commit together, so a delivery is never pending
// without a job or queued twice.
func (r *Repository) RequeueDelivery(ctx context.Context, id ids.ID, now time.Time) (domain.Delivery, bool, error) {
	const op = "webhooks.RedeliverDelivery"
	if r.jobs == nil {
		return domain.Delivery{}, false, sharederrors.Wrap(op, errors.New("repository has no job client"))
	}
	var (
		out      domain.Delivery
		requeued bool
	)
	err := database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := webhooksdb.New(tx)
		row, err := q.RequeueDelivery(ctx, webhooksdb.RequeueDeliveryParams{ID: uuid(id), UpdatedAt: timestamptz(now)})
		switch {
		case errors.Is(err, pgx.ErrNoRows):
			// Missing, not redeliverable, or its endpoint is disabled: the caller decides.
		case err != nil:
			return sharederrors.Wrap(op, err)
		default:
			requeued = true
			args := platformwebhooks.DeliveryArgs{
				EndpointID: ids.ID(row.EndpointID.Bytes).String(), EventID: ids.ID(row.EventID.Bytes).String(),
				EventType: row.EventType, Payload: row.Payload,
			}
			if _, err := r.jobs.InsertTx(ctx, tx, args, nil); err != nil {
				return sharederrors.Wrap(op, err)
			}
		}
		current, err := q.GetDelivery(ctx, uuid(id))
		if err != nil {
			return notFoundOr(op, "delivery", err)
		}
		out = deliveryFromRow(current)
		return nil
	})
	if err != nil {
		return domain.Delivery{}, false, err
	}
	return out, requeued, nil
}

// SubscribedEndpointIDs returns the active endpoints subscribed to eventType.
func (r *Repository) SubscribedEndpointIDs(ctx context.Context, tx pgx.Tx, eventType string) ([]ids.ID, error) {
	rows, err := webhooksdb.New(tx).ListSubscribedEndpointIDs(ctx, webhooksdb.ListSubscribedEndpointIDsParams{
		EventType: eventType, MaxEndpoints: maxFanOutEndpoints,
	})
	if err != nil {
		return nil, sharederrors.Wrap("webhooks.SubscribedEndpointIDs", err)
	}
	return fromUUIDs(rows), nil
}

// InsertDeliveries writes one pending delivery per endpoint in one statement and
// returns the endpoints a row was actually inserted for: an endpoint that already
// has a delivery of this event (a redelivered event) is left out.
func (r *Repository) InsertDeliveries(ctx context.Context, tx pgx.Tx, eventID ids.ID, eventType string, payload []byte, endpointIDs []ids.ID, now time.Time) ([]ids.ID, error) {
	deliveryIDs := make([]ids.ID, len(endpointIDs))
	for i := range deliveryIDs {
		deliveryIDs[i] = ids.New()
	}
	rows, err := webhooksdb.New(tx).InsertDeliveries(ctx, webhooksdb.InsertDeliveriesParams{
		EventID: uuid(eventID), EventType: eventType, Payload: payload, CreatedAt: timestamptz(now),
		Ids: toUUIDs(deliveryIDs), EndpointIds: toUUIDs(endpointIDs),
	})
	if err != nil {
		return nil, sharederrors.Wrap("webhooks.InsertDeliveries", err)
	}
	return fromUUIDs(rows), nil
}

// RecordOutcome writes what one attempt changed, in one transaction: the
// delivery row, and the endpoint's failure counter (reset by a success; a
// failure that reaches threshold disables the endpoint in the same statement).
// A delivery row that retention already purged is not an error.
func (r *Repository) RecordOutcome(ctx context.Context, o domain.Outcome, threshold int, now time.Time) error {
	const op = "webhooks.RecordOutcome"
	return database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := webhooksdb.New(tx)
		var delta int32
		if o.Sent {
			delta = 1
		}
		if _, err := q.RecordDeliveryAttempt(ctx, webhooksdb.RecordDeliveryAttemptParams{
			Status: string(o.Status), AttemptsDelta: delta, LastStatusCode: int32(o.StatusCode), LastError: o.Error,
			UpdatedAt: timestamptz(now), EndpointID: uuid(o.EndpointID), EventID: uuid(o.EventID),
		}); err != nil {
			return sharederrors.Wrap(op, err)
		}
		switch {
		case o.EndpointSucceeded:
			if err := q.ResetEndpointFailures(ctx, uuid(o.EndpointID)); err != nil {
				return sharederrors.Wrap(op, err)
			}
		case o.EndpointFailed:
			if err := q.RecordEndpointFailure(ctx, webhooksdb.RecordEndpointFailureParams{
				Threshold: int32(threshold), UpdatedAt: timestamptz(now), ID: uuid(o.EndpointID),
			}); err != nil {
				return sharederrors.Wrap(op, err)
			}
		}
		return nil
	})
}

// PurgeDeliveries is the retention purge: it deletes up to limit deliveries
// created before cutoff and returns how many.
func (r *Repository) PurgeDeliveries(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
	n, err := webhooksdb.New(r.pool).PurgeDeliveries(ctx, webhooksdb.PurgeDeliveriesParams{
		Cutoff: timestamptz(cutoff), BatchLimit: int32(limit),
	})
	if err != nil {
		return 0, sharederrors.Wrap("webhooks.PurgeDeliveries", err)
	}
	return n, nil
}
