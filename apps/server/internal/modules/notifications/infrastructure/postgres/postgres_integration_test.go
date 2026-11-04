//go:build integration

package postgres_test

import (
	"context"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"

	"github.com/aedst/server/internal/modules/notifications/application"
	"github.com/aedst/server/internal/modules/notifications/domain"
	notificationsjobs "github.com/aedst/server/internal/modules/notifications/infrastructure/jobs"
	"github.com/aedst/server/internal/modules/notifications/infrastructure/postgres"
	platformjobs "github.com/aedst/server/internal/platform/jobs"
	"github.com/aedst/server/internal/platform/postgrestest"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

func setup(t *testing.T) (*postgres.Repository, *application.Service, func(kind string) int) {
	t.Helper()
	pool := postgrestest.NewPool(t, "notifications")
	workers := river.NewWorkers()
	river.AddWorker(workers, notificationsjobs.NewFanOutWorker(nil, nil))
	river.AddWorker(workers, notificationsjobs.NewDeviceWorker(nil, nil, nil))
	client, err := platformjobs.NewClientWithQueues(pool, workers, slog.New(slog.DiscardHandler), nil) // insert-only
	if err != nil {
		t.Fatal(err)
	}
	repo := postgres.NewRepository(pool, client)
	count := func(kind string) (n int) {
		if err := pool.QueryRow(context.Background(), `SELECT count(*) FROM river_job WHERE kind = $1`, kind).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}
	return repo, application.NewService(repo, sharedtime.Real{}), count
}

func TestDevicesPreferencesAndReadState(t *testing.T) {
	repo, svc, _ := setup(t)
	ctx := context.Background()
	alice, bob := ids.New(), ids.New()

	d1, err := svc.RegisterPushDevice(ctx, alice, domain.PlatformFCM, "tok-1", "", "", "", "", false, "Pixel", "en")
	if err != nil {
		t.Fatal(err)
	}
	// Re-registering the same token refreshes the row; on a shared device it
	// moves to the new account.
	d1again, err := svc.RegisterPushDevice(ctx, bob, domain.PlatformFCM, "tok-1", "", "", "", "", false, "Pixel", "en")
	if err != nil || d1again != d1 {
		t.Fatalf("re-register = %s, %v; want the same device %s", d1again, err, d1)
	}
	if devices, _ := repo.ListActiveDevices(ctx, alice); len(devices) != 0 {
		t.Errorf("token still active for the previous account: %+v", devices)
	}
	if err := svc.UnregisterPushDevice(ctx, alice, d1); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Errorf("unregistering someone else's device: %v", err)
	}
	if err := svc.UnregisterPushDevice(ctx, bob, d1); err != nil {
		t.Fatal(err)
	}
	if _, ok, _ := repo.GetActiveDevice(ctx, d1); ok {
		t.Error("device still active after unregister")
	}

	prefs, err := svc.GetPreferences(ctx, alice)
	if err != nil || prefs != domain.DefaultPreferences() {
		t.Fatalf("defaults = %+v, %v", prefs, err)
	}
	want := domain.Preferences{PushEnabled: true, TaskDueSoon: true}
	if got, err := svc.UpdatePreferences(ctx, alice, want); err != nil || got != want {
		t.Fatalf("UpdatePreferences = %+v, %v", got, err)
	}
	if got, _ := svc.GetPreferences(ctx, alice); got != want {
		t.Errorf("stored preferences = %+v", got)
	}
}

func TestInsertBroadcastReadAndPushJobs(t *testing.T) {
	repo, svc, jobs := setup(t)
	ctx := context.Background()
	alice, bob := ids.New(), ids.New()
	if _, err := svc.RegisterPushDevice(ctx, bob, domain.PlatformAPNs, "abcd", "", "", "", "com.x", false, "", ""); err != nil {
		t.Fatal(err)
	}

	event := ids.New()
	insert := func() {
		t.Helper()
		err := repo.RunTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
			return repo.InsertTx(ctx, tx, domain.NewTaskCompleted(alice, event, ids.New(), "Ship", time.Now()))
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	insert()
	insert() // redelivery: no second row, no second push job
	if n := jobs("notifications.push"); n != 1 {
		t.Fatalf("push jobs = %d, want 1", n)
	}

	var recipients int64
	err := repo.RunTx(ctx, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		recipients, err = svc.BroadcastTx(ctx, tx, nil, domain.Broadcast{Title: "Maintenance", Link: "/status"})
		return err
	})
	if err != nil || recipients != 2 {
		t.Fatalf("broadcast to everyone = %d, %v; want alice (notification) + bob (device)", recipients, err)
	}
	if n := jobs("notifications.push"); n != 3 {
		t.Fatalf("push jobs after broadcast = %d, want 3", n)
	}

	if n, _ := svc.GetUnreadCount(ctx, alice); n != 2 {
		t.Fatalf("alice unread = %d, want 2", n)
	}
	page, err := svc.ListNotifications(ctx, alice, true, 10, "")
	if err != nil || len(page.Notifications) != 2 || page.Notifications[0].Kind != domain.KindSystem {
		t.Fatalf("unread page = %+v, %v", page, err)
	}
	if err := svc.MarkRead(ctx, alice, page.Notifications[0].ID, ids.New()); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Fatalf("MarkRead with a foreign id = %v, want NotFound and nothing marked", err)
	}
	if n, _ := svc.GetUnreadCount(ctx, alice); n != 2 {
		t.Fatalf("a rejected MarkRead half-applied: unread = %d", n)
	}
	if err := svc.MarkRead(ctx, alice, page.Notifications[0].ID); err != nil {
		t.Fatal(err)
	}
	if n, err := svc.MarkAllRead(ctx, alice); err != nil || n != 1 {
		t.Fatalf("MarkAllRead = %d, %v", n, err)
	}
	if n, _ := svc.GetUnreadCount(ctx, alice); n != 0 {
		t.Errorf("unread after MarkAllRead = %d", n)
	}
	if purged, err := repo.PurgeOlderThan(ctx, time.Now().Add(time.Hour), 100); err != nil || purged != 3 {
		t.Errorf("PurgeOlderThan = %d, %v", purged, err)
	}
}
