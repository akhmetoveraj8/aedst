package application_test

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/notifications/application"
	"github.com/aedst/server/internal/modules/notifications/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

type fakeRepo struct {
	listed      application.ListParams
	readIDs     []ids.ID
	readErr     error
	readAt      time.Time
	devices     int
	upserted    *domain.Device
	broadcast   *domain.Broadcast
	broadcastTo *ids.ID
	prefs       domain.Preferences
}

func (f *fakeRepo) List(_ context.Context, p application.ListParams) (application.ListResult, error) {
	f.listed = p
	return application.ListResult{}, nil
}

func (f *fakeRepo) CountUnread(context.Context, ids.ID, int) (int, error) { return 3, nil }

func (f *fakeRepo) MarkRead(_ context.Context, _ ids.ID, notificationIDs []ids.ID, at time.Time) error {
	f.readIDs, f.readAt = notificationIDs, at
	return f.readErr
}

func (f *fakeRepo) MarkAllRead(context.Context, ids.ID, time.Time) (int, error) { return 2, nil }

func (f *fakeRepo) UpsertDevice(_ context.Context, d domain.Device) (ids.ID, error) {
	f.upserted = &d
	return d.ID, nil
}

func (f *fakeRepo) CountActiveDevices(context.Context, ids.ID) (int, error) { return f.devices, nil }

func (f *fakeRepo) UnregisterDevice(context.Context, ids.ID, ids.ID, time.Time) error {
	return nil
}
func (f *fakeRepo) CountAllActiveDevices(context.Context) (int64, error) { return 0, nil }

func (f *fakeRepo) GetPreferences(context.Context, ids.ID) (domain.Preferences, error) {
	return f.prefs, nil
}

func (f *fakeRepo) SavePreferences(_ context.Context, _ ids.ID, p domain.Preferences, _ time.Time) (domain.Preferences, error) {
	f.prefs = p
	return p, nil
}

func (f *fakeRepo) BroadcastTx(_ context.Context, _ pgx.Tx, _ ids.ID, userID *ids.ID, b domain.Broadcast, _ time.Time) (int64, error) {
	f.broadcast, f.broadcastTo = &b, userID
	return 7, nil
}

func TestService_ListNotifications_ClampsLimitAndDecodesCursor(t *testing.T) {
	repo := &fakeRepo{}
	svc := application.NewService(repo, sharedtime.Fixed{At: time.Now()})
	user := ids.New()

	if _, err := svc.ListNotifications(context.Background(), user, false, 10_000, ""); err != nil {
		t.Fatalf("ListNotifications() error = %v", err)
	}
	if repo.listed.Limit != pagination.MaxLimit || repo.listed.After != nil || repo.listed.UserID != user {
		t.Errorf("repo saw %+v, want limit %d, no cursor, user %s", repo.listed, pagination.MaxLimit, user)
	}

	cursor := pagination.Cursor{Sort: application.SortToken, Key: time.Now(), ID: ids.New()}
	if _, err := svc.ListNotifications(context.Background(), user, false, 5, cursor.Encode()); err != nil {
		t.Fatalf("ListNotifications() with cursor error = %v", err)
	}
	if repo.listed.After == nil || repo.listed.After.ID != cursor.ID || repo.listed.Limit != 5 {
		t.Errorf("repo saw %+v, want the decoded cursor and limit 5", repo.listed)
	}
	// A full-feed cursor must not be replayed on the unread-only feed.
	if _, err := svc.ListNotifications(context.Background(), user, true, 5, cursor.Encode()); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("unread-only with a full-feed cursor: err = %v, want Validation", err)
	}
}

func TestService_ListNotifications_RejectsForeignCursor(t *testing.T) {
	svc := application.NewService(&fakeRepo{}, sharedtime.Fixed{At: time.Now()})
	foreign := pagination.Cursor{Sort: "due_date:asc", Key: time.Now(), ID: ids.New()}.Encode()

	for name, token := range map[string]string{"another ordering": foreign, "garbage": "not-a-cursor"} {
		_, err := svc.ListNotifications(context.Background(), ids.New(), false, 10, token)
		if sharederrors.KindOf(err) != sharederrors.KindValidation {
			t.Errorf("%s: error kind = %v, want KindValidation", name, sharederrors.KindOf(err))
		}
	}
}

func TestService_MarkRead_UsesClockAndPropagatesNotFound(t *testing.T) {
	now := time.Date(2026, 1, 2, 3, 4, 5, 0, time.UTC)
	repo := &fakeRepo{}
	svc := application.NewService(repo, sharedtime.Fixed{At: now})

	id := ids.New()
	if err := svc.MarkRead(context.Background(), ids.New(), id); err != nil {
		t.Fatalf("MarkRead() error = %v", err)
	}
	if !repo.readAt.Equal(now) || len(repo.readIDs) != 1 || repo.readIDs[0] != id {
		t.Errorf("repo saw %v at %v", repo.readIDs, repo.readAt)
	}
	if err := svc.MarkRead(context.Background(), ids.New()); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("MarkRead() with no ids = %v, want Validation", err)
	}

	repo.readErr = sharederrors.NotFound("test", "nope")
	if err := svc.MarkRead(context.Background(), ids.New(), ids.New()); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Errorf("MarkRead() = %v, want KindNotFound", err)
	}
}

func TestService_RegisterPushDevice(t *testing.T) {
	repo := &fakeRepo{}
	svc := application.NewService(repo, sharedtime.Fixed{At: time.Now()})
	user := ids.New()

	if _, err := svc.RegisterPushDevice(context.Background(), user, domain.PlatformWebPush, "", "http://insecure.example/push", "k", "a", "", false, "", ""); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("plain-http web push endpoint: err = %v, want Validation", err)
	}
	if _, err := svc.RegisterPushDevice(context.Background(), user, domain.PlatformFCM, "  ", "", "", "", "", false, "", ""); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("empty FCM token: err = %v, want Validation", err)
	}
	if _, err := svc.RegisterPushDevice(context.Background(), user, domain.PlatformAPNs, "abcd", "", "", "", "com.example", true, "iPhone", "en"); err != nil {
		t.Fatalf("RegisterPushDevice() = %v", err)
	}
	if repo.upserted == nil || repo.upserted.Address != "abcd" || repo.upserted.UserID != user || !repo.upserted.APNsSandbox {
		t.Errorf("upserted %+v", repo.upserted)
	}

	repo.devices = application.MaxDevicesPerUser
	if _, err := svc.RegisterPushDevice(context.Background(), user, domain.PlatformFCM, "tok", "", "", "", "", false, "", ""); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("over the device cap: err = %v, want Validation", err)
	}
}

func TestService_BroadcastTx_ValidatesInTheDomain(t *testing.T) {
	repo := &fakeRepo{}
	svc := application.NewService(repo, sharedtime.Fixed{At: time.Now()})

	for name, b := range map[string]domain.Broadcast{
		"empty title":       {Title: "  "},
		"absolute link":     {Title: "Hi", Link: "https://evil.example"},
		"protocol-relative": {Title: "Hi", Link: "//evil.example"},
	} {
		if _, err := svc.BroadcastTx(context.Background(), nil, nil, b); sharederrors.KindOf(err) != sharederrors.KindValidation {
			t.Errorf("%s: err = %v, want Validation", name, err)
		}
	}
	n, err := svc.BroadcastTx(context.Background(), nil, nil, domain.Broadcast{Title: " Maintenance ", Link: "/status"})
	if err != nil || n != 7 || repo.broadcast.Title != "Maintenance" || repo.broadcastTo != nil {
		t.Fatalf("BroadcastTx() = %d, %v; repo saw %+v to %v", n, err, repo.broadcast, repo.broadcastTo)
	}
}

func TestService_WebPushKeyAndPreferences(t *testing.T) {
	repo := &fakeRepo{}
	svc := application.NewService(repo, sharedtime.Fixed{At: time.Now()}, application.WithWebPushPublicKey("BPub"))
	if svc.WebPushPublicKey() != "BPub" {
		t.Error("public key not exposed")
	}
	want := domain.Preferences{PushEnabled: true, TaskDueSoon: true}
	got, err := svc.UpdatePreferences(context.Background(), ids.New(), want)
	if err != nil || got != want {
		t.Errorf("UpdatePreferences() = %+v, %v", got, err)
	}
}

func TestDomain_Notifications(t *testing.T) {
	user, event, task := ids.New(), ids.New(), ids.New()
	at := time.Date(2026, 5, 6, 7, 8, 9, 0, time.UTC)
	n := domain.NewTaskCompleted(user, event, task, "Ship it", at)
	if n.UserID != user || n.SourceEventID != event || !n.CreatedAt.Equal(at) || n.Kind != domain.KindTaskCompleted {
		t.Errorf("notification = %+v, want owner, source event and created_at taken from the event", n)
	}
	if n.Title != "Task completed: Ship it" || n.IsRead() || n.Link != "/tasks/"+task.String() || *n.SubjectID != task {
		t.Errorf("notification = %+v", n)
	}

	prefs := domain.DefaultPreferences()
	if !prefs.WantsPush(domain.KindTaskDueSoon) {
		t.Error("defaults must push")
	}
	prefs.TaskDueSoon = false
	if prefs.WantsPush(domain.KindTaskDueSoon) || !prefs.WantsPush(domain.KindTaskCompleted) {
		t.Error("per-kind switch not honoured")
	}
	prefs.PushEnabled = false
	if prefs.WantsPush(domain.KindSystem) {
		t.Error("the master switch must silence every kind")
	}
}
