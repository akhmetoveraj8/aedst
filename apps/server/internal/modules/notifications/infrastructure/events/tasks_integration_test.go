//go:build integration

// Integration tests against a real PostgreSQL container: the tasks ->
// notifications projection, end to end through River delivery (dispatched synchronously here) and the idempotent handler.
package events_test

import (
	"context"
	"encoding/json"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/notifications/application"
	"github.com/aedst/server/internal/modules/notifications/infrastructure/events"
	notificationspostgres "github.com/aedst/server/internal/modules/notifications/infrastructure/postgres"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	platformevents "github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

func taskCompleted(t *testing.T, eventID, userID ids.ID, title string, at time.Time) platformevents.Event {
	t.Helper()
	payload, err := json.Marshal(tasksapi.TaskCompletedEvent{TaskID: ids.New().String(), UserID: userID.String(), Title: title, CompletedAt: at})
	if err != nil {
		t.Fatal(err)
	}
	return platformevents.Event{ID: eventID, Type: tasksapi.TaskCompletedEventType, Version: 1, OccurredAt: at, Payload: payload}
}

func TestTaskCompleted_ProjectsOneNotificationPerEvent(t *testing.T) {
	pool := postgrestest.NewPool(t, "notifications")
	repo := notificationspostgres.NewRepository(pool, nil)
	registry := platformevents.NewRegistry()
	events.SubscribeTaskCompleted(registry, pool, repo)
	svc := application.NewService(repo, sharedtime.Real{})
	ctx := context.Background()

	user, other := ids.New(), ids.New()
	base := time.Now().UTC().Truncate(time.Microsecond)
	first := ids.New()
	if err := registry.Dispatch(ctx, taskCompleted(t, first, user, "first", base)); err != nil {
		t.Fatalf("Dispatch() error = %v", err)
	}
	// At-least-once delivery: the same event redelivered must change nothing.
	if err := registry.Dispatch(ctx, taskCompleted(t, first, user, "first", base)); err != nil {
		t.Fatalf("redelivered Dispatch() error = %v", err)
	}
	for i, title := range []string{"second", "third", "fourth"} {
		if err := registry.Dispatch(ctx, taskCompleted(t, ids.New(), user, title, base.Add(time.Duration(i+1)*time.Second))); err != nil {
			t.Fatalf("Dispatch(%s) error = %v", title, err)
		}
	}
	if err := registry.Dispatch(ctx, taskCompleted(t, ids.New(), other, "someone else's", base)); err != nil {
		t.Fatalf("Dispatch(other) error = %v", err)
	}

	var got []string
	token := ""
	for page := 0; ; page++ {
		res, err := svc.ListNotifications(ctx, user, false, 2, token)
		if err != nil {
			t.Fatalf("ListNotifications() page %d error = %v", page, err)
		}
		for _, n := range res.Notifications {
			got = append(got, n.Title)
		}
		if res.Next == nil {
			break
		}
		token = res.Next.Encode()
		if page > 10 {
			t.Fatal("pagination did not terminate")
		}
	}
	want := []string{"Task completed: fourth", "Task completed: third", "Task completed: second", "Task completed: first"}
	if len(got) != len(want) {
		t.Fatalf("feed = %v, want %v (redelivery must not duplicate, other users' events must not leak)", got, want)
	}
	for i := range want {
		if got[i] != want[i] {
			t.Fatalf("feed = %v, want %v", got, want)
		}
	}

	res, err := svc.ListNotifications(ctx, user, false, 1, "")
	if err != nil || len(res.Notifications) != 1 {
		t.Fatalf("ListNotifications() = %+v, %v", res, err)
	}
	id := res.Notifications[0].ID
	if err := svc.MarkRead(ctx, user, id); err != nil {
		t.Fatalf("MarkRead() error = %v", err)
	}
	if err := svc.MarkRead(ctx, other, id); err == nil {
		t.Fatal("MarkRead() by another user succeeded, want NotFound")
	}
}

// A malformed payload must fail the delivery (so River retries it and eventually
// discards it) rather than being silently dropped.
func TestTaskCompleted_MalformedPayloadFails(t *testing.T) {
	pool := postgrestest.NewPool(t, "notifications")
	registry := platformevents.NewRegistry()
	events.SubscribeTaskCompleted(registry, pool, notificationspostgres.NewRepository(pool, nil))

	err := registry.Dispatch(context.Background(), platformevents.Event{ID: ids.New(), Type: tasksapi.TaskCompletedEventType, Payload: []byte(`{"user_id":"nope"}`)})
	if err == nil {
		t.Fatal("Dispatch() error = nil, want a decode error")
	}
}
