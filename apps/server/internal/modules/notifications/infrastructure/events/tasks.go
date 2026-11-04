// Package events subscribes the notifications module to integration events
// published by other modules. It depends on a publisher module only through
// that module's api/ package (the event contract), never its internals.
// Each projection runs as a River delivery job (platform/events) and applies its
// effect in one transaction on the jobs pool, so the notification and its push job
// commit together; a redelivered event changes nothing (UNIQUE source_event_id).
package events

import (
	"context"
	"encoding/json"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	mediaapi "github.com/aedst/server/internal/modules/media/api"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"

	"github.com/aedst/server/internal/modules/notifications/domain"
	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/shared/ids"
)

// Consumer names: the River delivery job argument. Stable across deploys;
// renaming one strands its queued jobs.
const (
	taskCompletedConsumer = "notifications.task_completed"
	taskDueSoonConsumer   = "notifications.task_due_soon"
	mediaReadyConsumer    = "notifications.media_ready"
)

// Inserter stores a notification inside the consumer transaction. Satisfied by
// the module's postgres repository.
type Inserter interface {
	InsertTx(ctx context.Context, tx pgx.Tx, n domain.Notification) error
}

// Subscribe registers every projection of this module on registry.
func Subscribe(registry *events.Registry, pool *pgxpool.Pool, repo Inserter) {
	subscribe(registry, pool, tasksapi.TaskCompletedEventType, taskCompletedConsumer, func(ctx context.Context, tx pgx.Tx, eventID ids.ID, payload []byte) error {
		var evt tasksapi.TaskCompletedEvent
		userID, taskID, err := decode(payload, &evt, tasksapi.TaskCompletedEventType, func() (string, string) { return evt.UserID, evt.TaskID })
		if err != nil {
			return err
		}
		return repo.InsertTx(ctx, tx, domain.NewTaskCompleted(userID, eventID, taskID, evt.Title, evt.CompletedAt))
	})
	subscribe(registry, pool, tasksapi.TaskDueSoonEventType, taskDueSoonConsumer, func(ctx context.Context, tx pgx.Tx, eventID ids.ID, payload []byte) error {
		var evt tasksapi.TaskDueSoonEvent
		userID, taskID, err := decode(payload, &evt, tasksapi.TaskDueSoonEventType, func() (string, string) { return evt.UserID, evt.TaskID })
		if err != nil {
			return err
		}
		createdAt := evt.OccurredAt
		if createdAt.IsZero() {
			createdAt = evt.DueDate
		}
		return repo.InsertTx(ctx, tx, domain.NewTaskDueSoon(userID, eventID, taskID, evt.Title, evt.DueDate, createdAt))
	})
	subscribe(registry, pool, mediaapi.MediaReadyEventType, mediaReadyConsumer, func(ctx context.Context, tx pgx.Tx, eventID ids.ID, payload []byte) error {
		var evt mediaapi.MediaReadyEvent
		userID, mediaID, err := decode(payload, &evt, mediaapi.MediaReadyEventType, func() (string, string) { return evt.UserID, evt.MediaID })
		if err != nil {
			return err
		}
		return repo.InsertTx(ctx, tx, domain.NewMediaReady(userID, eventID, mediaID, evt.Filename, evt.ReadyAt))
	})
}

// SubscribeTaskCompleted is kept for callers (and tests) that only want the
// reference projection.
func SubscribeTaskCompleted(registry *events.Registry, pool *pgxpool.Pool, repo Inserter) {
	subscribe(registry, pool, tasksapi.TaskCompletedEventType, taskCompletedConsumer, func(ctx context.Context, tx pgx.Tx, eventID ids.ID, payload []byte) error {
		var evt tasksapi.TaskCompletedEvent
		userID, taskID, err := decode(payload, &evt, tasksapi.TaskCompletedEventType, func() (string, string) { return evt.UserID, evt.TaskID })
		if err != nil {
			return err
		}
		return repo.InsertTx(ctx, tx, domain.NewTaskCompleted(userID, eventID, taskID, evt.Title, evt.CompletedAt))
	})
}

func subscribe(registry *events.Registry, pool *pgxpool.Pool, eventType, consumer string, handle txHandler) {
	registry.Subscribe(eventType, consumer, func(ctx context.Context, e events.Event) error {
		return database.WithTx(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
			return handle(ctx, tx, e.ID, e.Payload)
		})
	})
}

// txHandler applies one event inside tx. It must be idempotent in e.ID: River
// delivers at-least-once.
type txHandler func(ctx context.Context, tx pgx.Tx, eventID ids.ID, payload []byte) error

// decode unmarshals payload into evt and parses the (user, subject) ids that
// fields returns. A malformed payload fails the delivery (retried, then
// discarded by River) instead of being silently dropped.
func decode(payload []byte, evt any, eventType string, fields func() (string, string)) (ids.ID, ids.ID, error) {
	if err := json.Unmarshal(payload, evt); err != nil {
		return ids.Nil, ids.Nil, fmt.Errorf("decode %s: %w", eventType, err)
	}
	rawUser, rawSubject := fields()
	userID, err := ids.Parse(rawUser)
	if err != nil {
		return ids.Nil, ids.Nil, fmt.Errorf("decode %s: user_id: %w", eventType, err)
	}
	subject, err := ids.Parse(rawSubject)
	if err != nil {
		return ids.Nil, ids.Nil, fmt.Errorf("decode %s: subject id: %w", eventType, err)
	}
	return userID, subject, nil
}
