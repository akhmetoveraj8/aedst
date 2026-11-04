// Package application holds the notifications module's use cases. It depends
// only on domain and the interfaces declared here.
package application

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/notifications/domain"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// Repository reads and updates a user's notifications, devices and
// preferences. Event-driven creation happens in infrastructure/events inside
// the consumer transaction (Store.InsertTx), not through this port.
type Repository interface {
	List(ctx context.Context, params ListParams) (ListResult, error)
	CountUnread(ctx context.Context, userID ids.ID, limit int) (int, error)
	// MarkRead marks the given ids read; NotFound if any id is not the
	// user's (never distinguishing "not yours" from "does not exist").
	MarkRead(ctx context.Context, userID ids.ID, ids []ids.ID, at time.Time) error
	MarkAllRead(ctx context.Context, userID ids.ID, at time.Time) (int, error)

	UpsertDevice(ctx context.Context, d domain.Device) (ids.ID, error)
	CountActiveDevices(ctx context.Context, userID ids.ID) (int, error)
	UnregisterDevice(ctx context.Context, userID, deviceID ids.ID, at time.Time) error
	CountAllActiveDevices(ctx context.Context) (int64, error)

	GetPreferences(ctx context.Context, userID ids.ID) (domain.Preferences, error)
	SavePreferences(ctx context.Context, userID ids.ID, p domain.Preferences, at time.Time) (domain.Preferences, error)

	// BroadcastTx inserts a SYSTEM notification inside the caller's
	// transaction (the admin audit transaction) for one user, or for every
	// known user when userID is nil, and enqueues their pushes in the same
	// transaction. It returns the number of recipients.
	BroadcastTx(ctx context.Context, tx pgx.Tx, broadcastID ids.ID, userID *ids.ID, b domain.Broadcast, at time.Time) (int64, error)
}

// ListParams selects one keyset page of a user's feed, newest first.
type ListParams struct {
	UserID     ids.ID
	UnreadOnly bool
	Limit      int
	After      *pagination.Cursor
}

// SortToken names the ordering; embedded in cursors (see internal/shared/pagination).
const SortToken = "created_at:desc" //nolint:gosec // G101 false positive: a pagination sort-token name, not a credential

// UnreadSortToken keeps unread-only cursors from being replayed on the full feed.
const UnreadSortToken = "unread:created_at:desc"

// ListResult is one page of notifications; Next is nil on the last page.
type ListResult struct {
	Notifications []domain.Notification
	Next          *pagination.Cursor
}

// WebPushKey reports the VAPID public key ("" when Web Push is not configured).
type WebPushKey interface {
	PublicKey() string
}
