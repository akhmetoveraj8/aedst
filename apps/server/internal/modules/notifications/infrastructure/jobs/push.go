// Package jobs delivers push notifications from River jobs. Delivery is two
// steps so retries are per device:
//
//	notifications.push         (one per notification, enqueued in the same
//	                            transaction that created the notification)
//	  -> notifications.push_device (one per active device, unique by args)
//
// A device job that fails transiently is retried by River on its own; one that
// reports an invalid token deactivates the device and succeeds; a provider
// that is not configured skips the device.
package jobs

import (
	"context"
	"errors"
	"log/slog"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/modules/notifications/domain"
	"github.com/aedst/server/internal/platform/push"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// PushArgs fans one notification out to the owner's devices.
type PushArgs struct {
	NotificationID string `json:"notification_id" river:"unique"`
}

func (PushArgs) Kind() string { return "notifications.push" }

func (PushArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: 5, UniqueOpts: river.UniqueOpts{ByArgs: true}}
}

// PushDeviceArgs delivers one notification to one device.
type PushDeviceArgs struct {
	NotificationID string `json:"notification_id" river:"unique"`
	DeviceID       string `json:"device_id" river:"unique"`
}

func (PushDeviceArgs) Kind() string { return "notifications.push_device" }

func (PushDeviceArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: 8, UniqueOpts: river.UniqueOpts{ByArgs: true}}
}

// TxInserter is the subset of the River client the module needs.
type TxInserter interface {
	InsertTx(ctx context.Context, tx pgx.Tx, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
	InsertManyTx(ctx context.Context, tx pgx.Tx, params []river.InsertManyParams) ([]*rivertype.JobInsertResult, error)
}

// Store is what the workers read and update (the module's postgres
// repository, on the jobs pool).
type Store interface {
	GetNotification(ctx context.Context, id ids.ID) (domain.Notification, error)
	GetPreferences(ctx context.Context, userID ids.ID) (domain.Preferences, error)
	ListActiveDevices(ctx context.Context, userID ids.ID) ([]domain.Device, error)
	GetActiveDevice(ctx context.Context, id ids.ID) (domain.Device, bool, error)
	DeactivateDevice(ctx context.Context, id ids.ID, at time.Time) error
	// CountUnread feeds the APNs badge.
	CountUnread(ctx context.Context, userID ids.ID, limit int) (int, error)
	// EnqueueDevicePushes inserts one PushDeviceArgs job per device.
	EnqueueDevicePushes(ctx context.Context, notificationID ids.ID, devices []ids.ID) error
}

// FanOutWorker runs PushArgs.
type FanOutWorker struct {
	river.WorkerDefaults[PushArgs]
	store  Store
	logger *slog.Logger
}

func NewFanOutWorker(store Store, logger *slog.Logger) *FanOutWorker {
	return &FanOutWorker{store: store, logger: logger}
}

func (w *FanOutWorker) Work(ctx context.Context, job *river.Job[PushArgs]) error {
	id, err := ids.Parse(job.Args.NotificationID)
	if err != nil {
		return river.JobCancel(err)
	}
	n, err := w.store.GetNotification(ctx, id)
	if err != nil {
		return err // NotFound included: purged notifications are rare; River gives up after MaxAttempts
	}
	prefs, err := w.store.GetPreferences(ctx, n.UserID)
	if err != nil {
		return err
	}
	if !prefs.WantsPush(n.Kind) {
		return nil
	}
	devices, err := w.store.ListActiveDevices(ctx, n.UserID)
	if err != nil {
		return err
	}
	if len(devices) == 0 {
		return nil
	}
	deviceIDs := make([]ids.ID, len(devices))
	for i, d := range devices {
		deviceIDs[i] = d.ID
	}
	return w.store.EnqueueDevicePushes(ctx, id, deviceIDs)
}

// DeviceWorker runs PushDeviceArgs.
type DeviceWorker struct {
	river.WorkerDefaults[PushDeviceArgs]
	store  Store
	sender push.Sender
	logger *slog.Logger
	now    func() time.Time
}

func NewDeviceWorker(store Store, sender push.Sender, logger *slog.Logger) *DeviceWorker {
	return &DeviceWorker{store: store, sender: sender, logger: logger, now: sharedtime.Real{}.Now}
}

// Timeout bounds one delivery attempt (the provider client has its own).
func (w *DeviceWorker) Timeout(*river.Job[PushDeviceArgs]) time.Duration { return 30 * time.Second }

func (w *DeviceWorker) Work(ctx context.Context, job *river.Job[PushDeviceArgs]) error {
	notificationID, err := ids.Parse(job.Args.NotificationID)
	if err != nil {
		return river.JobCancel(err)
	}
	deviceID, err := ids.Parse(job.Args.DeviceID)
	if err != nil {
		return river.JobCancel(err)
	}
	device, ok, err := w.store.GetActiveDevice(ctx, deviceID)
	if err != nil {
		return err
	}
	if !ok {
		return nil // unregistered or deactivated since fan-out
	}
	n, err := w.store.GetNotification(ctx, notificationID)
	if err != nil {
		return err
	}
	if n.UserID != device.UserID {
		return nil // the device moved to another account since fan-out
	}

	msg := MessageOf(n)
	if unread, err := w.store.CountUnread(ctx, n.UserID, 99); err == nil {
		msg.Badge = &unread
	}
	err = w.sender.Send(ctx, TargetOf(device), msg)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, push.ErrInvalidToken):
		w.logger.InfoContext(ctx, "push: deactivating invalid device", slog.String("device_id", deviceID.String()), slog.Any("reason", err))
		return w.store.DeactivateDevice(ctx, deviceID, w.now())
	case errors.Is(err, push.ErrDisabled):
		return nil
	case errors.Is(err, push.ErrPermanent):
		w.logger.WarnContext(ctx, "push: permanent delivery failure", slog.String("device_id", deviceID.String()), slog.Any("error", err))
		return river.JobCancel(err)
	default:
		return err // transient: River retries with backoff
	}
}

// TargetOf maps a device registration to a provider target.
func TargetOf(d domain.Device) push.Target {
	t := push.Target{Platform: push.Platform(d.Platform), APNsTopic: d.APNsTopic, APNsSandbox: d.APNsSandbox}
	if d.Platform == domain.PlatformWebPush {
		t.Endpoint, t.P256dh, t.Auth = d.Address, d.P256dh, d.AuthSecret
	} else {
		t.Token = d.Address
	}
	return t
}

// MessageOf maps a notification to a push message.
func MessageOf(n domain.Notification) push.Message {
	msg := push.Message{
		Title:          n.Title,
		Body:           n.Body,
		Link:           n.Link,
		Kind:           string(n.Kind),
		NotificationID: n.ID.String(),
		CollapseID:     n.ID.String(),
		TTL:            24 * time.Hour,
		Data:           map[string]string{},
	}
	if n.SubjectID != nil {
		msg.Data["subject_id"] = n.SubjectID.String()
	}
	return msg
}
