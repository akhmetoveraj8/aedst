// Package events subscribes the webhooks module to the integration events it
// offers to endpoints. It depends on a publisher module only through that
// module's api/ package (the event type), never its internals.
//
// Each subscription is the fan-out of one event type: in one transaction on the
// jobs pool it writes one webhooks.deliveries row and one platform.webhook_delivery
// River job per active endpoint subscribed to the type. A redelivered event
// changes nothing: the row is UNIQUE on (endpoint, event id) and only endpoints
// whose row was inserted get a job. The payload is forwarded as published; this
// package never decodes it, so an event gaining a field needs no change here.
package events

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	mediaapi "github.com/aedst/server/internal/modules/media/api"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/webhooks"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// Store is the part of the module's repository the fan-out writes through.
type Store interface {
	SubscribedEndpointIDs(ctx context.Context, tx pgx.Tx, eventType string) ([]ids.ID, error)
	InsertDeliveries(ctx context.Context, tx pgx.Tx, eventID ids.ID, eventType string, payload []byte, endpointIDs []ids.ID, now time.Time) ([]ids.ID, error)
}

// JobInserter enqueues the delivery jobs inside the fan-out transaction.
// Satisfied by the River client (platform/jobs.Client).
type JobInserter interface {
	InsertManyTx(ctx context.Context, tx pgx.Tx, params []river.InsertManyParams) ([]*rivertype.JobInsertResult, error)
}

// TxRunner runs fn in one transaction on the jobs pool (database.WithTx).
type TxRunner func(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error

// Subscribe registers the fan-out for every event type offered to webhooks.
// The consumer names are stored in job args: never rename one. The module's
// Consumes declaration lists the same pairs (architecturetest compares them).
func Subscribe(registry *events.Registry, inTx TxRunner, store Store, jobs JobInserter, clock sharedtime.Clock) {
	h := fanOut(inTx, store, jobs, clock)
	registry.Subscribe(tasksapi.TaskCreatedEventType, "webhooks.fanout_task_created", h)
	registry.Subscribe(tasksapi.TaskUpdatedEventType, "webhooks.fanout_task_updated", h)
	registry.Subscribe(tasksapi.TaskCompletedEventType, "webhooks.fanout_task_completed", h)
	registry.Subscribe(tasksapi.TaskDeletedEventType, "webhooks.fanout_task_deleted", h)
	registry.Subscribe(tasksapi.TaskDueSoonEventType, "webhooks.fanout_task_due_soon", h)
	registry.Subscribe(mediaapi.MediaReadyEventType, "webhooks.fanout_media_ready", h)
	registry.Subscribe(mediaapi.MediaDeletedEventType, "webhooks.fanout_media_deleted", h)
}

// fanOut is the handler of every subscription. It must be idempotent in the
// event id: River delivers at least once.
func fanOut(inTx TxRunner, store Store, jobs JobInserter, clock sharedtime.Clock) events.Handler {
	return func(ctx context.Context, e events.Event) error {
		return inTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
			endpoints, err := store.SubscribedEndpointIDs(ctx, tx, e.Type)
			if err != nil || len(endpoints) == 0 {
				return err
			}
			inserted, err := store.InsertDeliveries(ctx, tx, e.ID, e.Type, e.Payload, endpoints, clock.Now())
			if err != nil || len(inserted) == 0 {
				return err
			}
			params := make([]river.InsertManyParams, len(inserted))
			for i, endpointID := range inserted {
				params[i] = river.InsertManyParams{Args: webhooks.DeliveryArgs{
					EndpointID: endpointID.String(), EventID: e.ID.String(), EventType: e.Type, Payload: e.Payload,
				}}
			}
			if _, err := jobs.InsertManyTx(ctx, tx, params); err != nil {
				return fmt.Errorf("webhooks: enqueue deliveries of %s: %w", e.Type, err)
			}
			return nil
		})
	}
}
