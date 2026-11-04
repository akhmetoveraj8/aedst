// Package postgres implements the notifications module's persistence against
// the sqlc-generated queries in gen/db/notifications. Not imported outside
// this module.
package postgres

import (
	"context"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"

	notificationsdb "github.com/aedst/server/gen/db/notifications"
	"github.com/aedst/server/internal/modules/notifications/application"
	"github.com/aedst/server/internal/modules/notifications/domain"
	notificationsjobs "github.com/aedst/server/internal/modules/notifications/infrastructure/jobs"
	"github.com/aedst/server/internal/platform/database"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

type Repository struct {
	pool *pgxpool.Pool
	jobs notificationsjobs.TxInserter
}

// NewRepository builds the repository. jobs enqueues push deliveries in the
// same transaction as the notification; nil disables push (reads only).
func NewRepository(pool *pgxpool.Pool, jobs notificationsjobs.TxInserter) *Repository {
	return &Repository{pool: pool, jobs: jobs}
}

var (
	_ application.Repository  = (*Repository)(nil)
	_ notificationsjobs.Store = (*Repository)(nil)
)

// InsertTx stores n inside tx — the transaction of the River delivery job of the consumer that
// applies the source event — so the notification and its
// push job commit together. A second insert for the same
// source event is a no-op (UNIQUE source_event_id) and enqueues nothing.
func (r *Repository) InsertTx(ctx context.Context, tx pgx.Tx, n domain.Notification) error {
	_, err := notificationsdb.New(tx).InsertNotification(ctx, notificationsdb.InsertNotificationParams{
		ID:            toPgUUID(n.ID),
		UserID:        toPgUUID(n.UserID),
		Kind:          string(n.Kind),
		Title:         n.Title,
		Body:          n.Body,
		Link:          n.Link,
		SubjectID:     toPgUUIDPtr(n.SubjectID),
		SourceEventID: toPgUUID(n.SourceEventID),
		CreatedAt:     pgtype.Timestamptz{Time: n.CreatedAt, Valid: true},
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil // already projected
	}
	if err != nil {
		return sharederrors.Wrap("notifications.InsertTx", err)
	}
	return r.enqueuePush(ctx, tx, []ids.ID{n.ID})
}

func (r *Repository) enqueuePush(ctx context.Context, tx pgx.Tx, notificationIDs []ids.ID) error {
	if r.jobs == nil || len(notificationIDs) == 0 {
		return nil
	}
	params := make([]river.InsertManyParams, len(notificationIDs))
	for i, id := range notificationIDs {
		params[i] = river.InsertManyParams{Args: notificationsjobs.PushArgs{NotificationID: id.String()}}
	}
	if _, err := r.jobs.InsertManyTx(ctx, tx, params); err != nil {
		return sharederrors.Wrap("notifications.enqueuePush", err)
	}
	return nil
}

func (r *Repository) BroadcastTx(ctx context.Context, tx pgx.Tx, broadcastID ids.ID, userID *ids.ID, b domain.Broadcast, at time.Time) (int64, error) {
	q := notificationsdb.New(tx)
	if userID != nil {
		n := domain.Notification{ID: ids.New(), UserID: *userID, Kind: domain.KindSystem, Title: b.Title, Body: b.Body, Link: b.Link, SourceEventID: broadcastID, CreatedAt: at}
		if err := r.InsertTx(ctx, tx, n); err != nil {
			return 0, err
		}
		return 1, nil
	}
	rows, err := q.BroadcastNotification(ctx, notificationsdb.BroadcastNotificationParams{
		Title:       b.Title,
		Body:        b.Body,
		Link:        b.Link,
		BroadcastID: broadcastID.String(),
		CreatedAt:   pgtype.Timestamptz{Time: at, Valid: true},
	})
	if err != nil {
		return 0, sharederrors.Wrap("notifications.BroadcastTx", err)
	}
	created := make([]ids.ID, len(rows))
	for i, row := range rows {
		created[i] = ids.ID(row.ID.Bytes)
	}
	if err := r.enqueuePush(ctx, tx, created); err != nil {
		return 0, err
	}
	return int64(len(rows)), nil
}

func (r *Repository) List(ctx context.Context, params application.ListParams) (application.ListResult, error) {
	// Open cursor for the first page: every row sorts before it (DESC).
	cursorKey := pgtype.Timestamptz{InfinityModifier: pgtype.Infinity, Valid: true}
	cursorID := pgtype.UUID{Bytes: [16]byte{0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff, 0xff}, Valid: true}
	if params.After != nil {
		cursorKey = pgtype.Timestamptz{Time: params.After.Key, Valid: true}
		cursorID = toPgUUID(params.After.ID)
	}
	q := notificationsdb.New(r.pool)
	var (
		rows []notificationsdb.NotificationsNotification
		err  error
	)
	if params.UnreadOnly {
		rows, err = q.ListUnreadNotifications(ctx, notificationsdb.ListUnreadNotificationsParams{
			UserID: toPgUUID(params.UserID), CursorKey: cursorKey, CursorID: cursorID, PageLimit: int32(params.Limit) + 1,
		})
	} else {
		rows, err = q.ListNotifications(ctx, notificationsdb.ListNotificationsParams{
			UserID: toPgUUID(params.UserID), CursorKey: cursorKey, CursorID: cursorID, PageLimit: int32(params.Limit) + 1,
		})
	}
	if err != nil {
		return application.ListResult{}, sharederrors.Wrap("notifications.List", err)
	}

	items := make([]domain.Notification, len(rows))
	for i, row := range rows {
		items[i] = fromDB(row)
	}
	sort := application.SortToken
	if params.UnreadOnly {
		sort = application.UnreadSortToken
	}
	page := pagination.NewPage(items, params.Limit, func(n domain.Notification) pagination.Cursor {
		return pagination.Cursor{Sort: sort, Key: n.CreatedAt, ID: n.ID}
	})
	return application.ListResult{Notifications: page.Items, Next: page.Next}, nil
}

func (r *Repository) CountUnread(ctx context.Context, userID ids.ID, limit int) (int, error) {
	n, err := notificationsdb.New(r.pool).CountUnread(ctx, notificationsdb.CountUnreadParams{UserID: toPgUUID(userID), Cap: int32(limit)})
	if err != nil {
		return 0, sharederrors.Wrap("notifications.CountUnread", err)
	}
	return int(n), nil
}

// MarkRead marks the ids read in one transaction: NotFound unless every id is
// the caller's, so a mixed request never half-applies.
func (r *Repository) MarkRead(ctx context.Context, userID ids.ID, notificationIDs []ids.ID, at time.Time) error {
	pg := make([]pgtype.UUID, len(notificationIDs))
	unique := map[ids.ID]bool{}
	for i, id := range notificationIDs {
		pg[i] = toPgUUID(id)
		unique[id] = true
	}
	return database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := notificationsdb.New(tx)
		owned, err := q.CountOwnedNotifications(ctx, notificationsdb.CountOwnedNotificationsParams{UserID: toPgUUID(userID), Ids: pg})
		if err != nil {
			return sharederrors.Wrap("notifications.MarkRead", err)
		}
		if int(owned) != len(unique) {
			return sharederrors.NotFound("notifications.MarkRead", "notification not found")
		}
		if _, err := q.MarkNotificationsRead(ctx, notificationsdb.MarkNotificationsReadParams{
			ReadAt: pgtype.Timestamptz{Time: at, Valid: true}, UserID: toPgUUID(userID), Ids: pg,
		}); err != nil {
			return sharederrors.Wrap("notifications.MarkRead", err)
		}
		return nil
	})
}

func (r *Repository) MarkAllRead(ctx context.Context, userID ids.ID, at time.Time) (int, error) {
	n, err := notificationsdb.New(r.pool).MarkAllNotificationsRead(ctx, notificationsdb.MarkAllNotificationsReadParams{
		ReadAt: pgtype.Timestamptz{Time: at, Valid: true}, UserID: toPgUUID(userID),
	})
	if err != nil {
		return 0, sharederrors.Wrap("notifications.MarkAllRead", err)
	}
	return int(n), nil
}

// PurgeOlderThan deletes up to limit notifications created before cutoff
// (retention policy "notifications.notifications").
func (r *Repository) PurgeOlderThan(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
	n, err := notificationsdb.New(r.pool).PurgeNotifications(ctx, notificationsdb.PurgeNotificationsParams{
		Cutoff: pgtype.Timestamptz{Time: cutoff, Valid: true}, RowLimit: int32(limit),
	})
	if err != nil {
		return 0, sharederrors.Wrap("notifications.Purge", err)
	}
	return n, nil
}

// PurgeDisabledDevices deletes up to limit devices disabled before cutoff.
func (r *Repository) PurgeDisabledDevices(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
	n, err := notificationsdb.New(r.pool).PurgeDisabledPushDevices(ctx, notificationsdb.PurgeDisabledPushDevicesParams{
		Cutoff: pgtype.Timestamptz{Time: cutoff, Valid: true}, RowLimit: int32(limit),
	})
	if err != nil {
		return 0, sharederrors.Wrap("notifications.PurgeDevices", err)
	}
	return n, nil
}

// --- devices ---

func (r *Repository) UpsertDevice(ctx context.Context, d domain.Device) (ids.ID, error) {
	id, err := notificationsdb.New(r.pool).UpsertPushDevice(ctx, notificationsdb.UpsertPushDeviceParams{
		ID:          toPgUUID(d.ID),
		UserID:      toPgUUID(d.UserID),
		Platform:    string(d.Platform),
		Address:     d.Address,
		P256dh:      d.P256dh,
		AuthSecret:  d.AuthSecret,
		ApnsTopic:   d.APNsTopic,
		ApnsSandbox: d.APNsSandbox,
		DeviceName:  d.DeviceName,
		Locale:      d.Locale,
		CreatedAt:   pgtype.Timestamptz{Time: d.CreatedAt, Valid: true},
	})
	if err != nil {
		return ids.Nil, sharederrors.Wrap("notifications.UpsertDevice", err)
	}
	return ids.ID(id.Bytes), nil
}

func (r *Repository) CountActiveDevices(ctx context.Context, userID ids.ID) (int, error) {
	n, err := notificationsdb.New(r.pool).CountActivePushDevices(ctx, toPgUUID(userID))
	if err != nil {
		return 0, sharederrors.Wrap("notifications.CountActiveDevices", err)
	}
	return int(n), nil
}

func (r *Repository) CountAllActiveDevices(ctx context.Context) (int64, error) {
	n, err := notificationsdb.New(r.pool).CountAllActivePushDevices(ctx)
	if err != nil {
		return 0, sharederrors.Wrap("notifications.CountAllActiveDevices", err)
	}
	return n, nil
}

func (r *Repository) UnregisterDevice(ctx context.Context, userID, deviceID ids.ID, at time.Time) error {
	n, err := notificationsdb.New(r.pool).UnregisterPushDevice(ctx, notificationsdb.UnregisterPushDeviceParams{
		At: pgtype.Timestamptz{Time: at, Valid: true}, ID: toPgUUID(deviceID), UserID: toPgUUID(userID),
	})
	if err != nil {
		return sharederrors.Wrap("notifications.UnregisterDevice", err)
	}
	if n == 0 {
		return sharederrors.NotFound("notifications.UnregisterDevice", "device not found")
	}
	return nil
}

func (r *Repository) ListActiveDevices(ctx context.Context, userID ids.ID) ([]domain.Device, error) {
	rows, err := notificationsdb.New(r.pool).ListActivePushDevices(ctx, toPgUUID(userID))
	if err != nil {
		return nil, sharederrors.Wrap("notifications.ListActiveDevices", err)
	}
	out := make([]domain.Device, len(rows))
	for i, row := range rows {
		out[i] = deviceFromDB(row)
	}
	return out, nil
}

func (r *Repository) GetActiveDevice(ctx context.Context, id ids.ID) (domain.Device, bool, error) {
	row, err := notificationsdb.New(r.pool).GetActivePushDevice(ctx, toPgUUID(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Device{}, false, nil
	}
	if err != nil {
		return domain.Device{}, false, sharederrors.Wrap("notifications.GetActiveDevice", err)
	}
	return deviceFromDB(row), true, nil
}

func (r *Repository) DeactivateDevice(ctx context.Context, id ids.ID, at time.Time) error {
	if err := notificationsdb.New(r.pool).DeactivatePushDevice(ctx, notificationsdb.DeactivatePushDeviceParams{
		At: pgtype.Timestamptz{Time: at, Valid: true}, ID: toPgUUID(id),
	}); err != nil {
		return sharederrors.Wrap("notifications.DeactivateDevice", err)
	}
	return nil
}

func (r *Repository) EnqueueDevicePushes(ctx context.Context, notificationID ids.ID, devices []ids.ID) error {
	if r.jobs == nil {
		return nil
	}
	return database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		params := make([]river.InsertManyParams, len(devices))
		for i, d := range devices {
			params[i] = river.InsertManyParams{Args: notificationsjobs.PushDeviceArgs{NotificationID: notificationID.String(), DeviceID: d.String()}}
		}
		if _, err := r.jobs.InsertManyTx(ctx, tx, params); err != nil {
			return sharederrors.Wrap("notifications.EnqueueDevicePushes", err)
		}
		return nil
	})
}

func (r *Repository) GetNotification(ctx context.Context, id ids.ID) (domain.Notification, error) {
	row, err := notificationsdb.New(r.pool).GetNotification(ctx, toPgUUID(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Notification{}, sharederrors.NotFound("notifications.Get", "notification not found")
	}
	if err != nil {
		return domain.Notification{}, sharederrors.Wrap("notifications.Get", err)
	}
	return fromDB(row), nil
}

// --- preferences ---

func (r *Repository) GetPreferences(ctx context.Context, userID ids.ID) (domain.Preferences, error) {
	row, err := notificationsdb.New(r.pool).GetPreferences(ctx, toPgUUID(userID))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.DefaultPreferences(), nil
	}
	if err != nil {
		return domain.Preferences{}, sharederrors.Wrap("notifications.GetPreferences", err)
	}
	return prefsFromDB(row), nil
}

func (r *Repository) SavePreferences(ctx context.Context, userID ids.ID, p domain.Preferences, at time.Time) (domain.Preferences, error) {
	row, err := notificationsdb.New(r.pool).UpsertPreferences(ctx, notificationsdb.UpsertPreferencesParams{
		UserID:        toPgUUID(userID),
		PushEnabled:   p.PushEnabled,
		TaskCompleted: p.TaskCompleted,
		TaskDueSoon:   p.TaskDueSoon,
		MediaReady:    p.MediaReady,
		UpdatedAt:     pgtype.Timestamptz{Time: at, Valid: true},
	})
	if err != nil {
		return domain.Preferences{}, sharederrors.Wrap("notifications.SavePreferences", err)
	}
	return prefsFromDB(row), nil
}

func prefsFromDB(row notificationsdb.NotificationsPreference) domain.Preferences {
	return domain.Preferences{PushEnabled: row.PushEnabled, TaskCompleted: row.TaskCompleted, TaskDueSoon: row.TaskDueSoon, MediaReady: row.MediaReady}
}

func deviceFromDB(row notificationsdb.NotificationsPushDevice) domain.Device {
	return domain.Device{
		ID:          ids.ID(row.ID.Bytes),
		UserID:      ids.ID(row.UserID.Bytes),
		Platform:    domain.Platform(row.Platform),
		Address:     row.Address,
		P256dh:      row.P256dh,
		AuthSecret:  row.AuthSecret,
		APNsTopic:   row.ApnsTopic,
		APNsSandbox: row.ApnsSandbox,
		DeviceName:  row.DeviceName,
		Locale:      row.Locale,
		CreatedAt:   row.CreatedAt.Time,
	}
}

func fromDB(row notificationsdb.NotificationsNotification) domain.Notification {
	n := domain.Notification{
		ID:            ids.ID(row.ID.Bytes),
		UserID:        ids.ID(row.UserID.Bytes),
		Kind:          domain.Kind(row.Kind),
		Title:         row.Title,
		Body:          row.Body,
		Link:          row.Link,
		SourceEventID: ids.ID(row.SourceEventID.Bytes),
		CreatedAt:     row.CreatedAt.Time,
	}
	if row.SubjectID.Valid {
		s := ids.ID(row.SubjectID.Bytes)
		n.SubjectID = &s
	}
	if row.ReadAt.Valid {
		n.ReadAt = &row.ReadAt.Time
	}
	return n
}

func toPgUUID(id ids.ID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: !id.IsNil()} }

func toPgUUIDPtr(id *ids.ID) pgtype.UUID {
	if id == nil {
		return pgtype.UUID{}
	}
	return toPgUUID(*id)
}

// RunTx runs fn in a transaction on the repository's pool (tests and
// non-event entry points that need InsertTx outside a delivery job).
func (r *Repository) RunTx(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
	return database.WithTx(ctx, r.pool, fn)
}
