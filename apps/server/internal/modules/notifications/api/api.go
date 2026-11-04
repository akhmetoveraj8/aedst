// Package api is the notifications module's public boundary. Nothing outside
// this module may import notifications' other packages. Notifications are
// created from other modules' integration events (infrastructure/events);
// the one synchronous write entry point is Broadcaster, used by the admin
// module inside its audit transaction.
package api

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/notifications/application"
	"github.com/aedst/server/internal/modules/notifications/domain"
	"github.com/aedst/server/internal/shared/ids"
)

type (
	Notification = domain.Notification
	Kind         = domain.Kind
	Platform     = domain.Platform
	Preferences  = domain.Preferences
	Broadcast    = domain.Broadcast
	ListResult   = application.ListResult
)

const (
	KindTaskCompleted = domain.KindTaskCompleted
	KindTaskDueSoon   = domain.KindTaskDueSoon
	KindMediaReady    = domain.KindMediaReady
	KindSystem        = domain.KindSystem

	PlatformWebPush = domain.PlatformWebPush
	PlatformFCM     = domain.PlatformFCM
	PlatformAPNs    = domain.PlatformAPNs
)

// Service is everything a transport can do with notifications. Every method
// takes userID explicitly, derived by the caller from the authenticated
// context.
type Service interface {
	ListNotifications(ctx context.Context, userID ids.ID, unreadOnly bool, limit int32, token string) (ListResult, error)
	GetUnreadCount(ctx context.Context, userID ids.ID) (int, error)
	MarkRead(ctx context.Context, userID ids.ID, notificationIDs ...ids.ID) error
	MarkAllRead(ctx context.Context, userID ids.ID) (int, error)
	RegisterPushDevice(ctx context.Context, userID ids.ID, platform Platform, token, endpoint, p256dh, auth, apnsTopic string, apnsSandbox bool, name, locale string) (ids.ID, error)
	UnregisterPushDevice(ctx context.Context, userID, deviceID ids.ID) error
	WebPushPublicKey() string
	GetPreferences(ctx context.Context, userID ids.ID) (Preferences, error)
	UpdatePreferences(ctx context.Context, userID ids.ID, p Preferences) (Preferences, error)
}

// Broadcaster is the operator entry point (admin module). BroadcastTx runs in
// the caller's transaction so the audit entry and the notifications (and
// their push jobs) commit atomically. userID nil means every known user.
type Broadcaster interface {
	BroadcastTx(ctx context.Context, tx pgx.Tx, userID *ids.ID, b Broadcast) (recipients int64, err error)
	CountActiveDevices(ctx context.Context) (int64, error)
}

var (
	_ Service     = (*application.Service)(nil)
	_ Broadcaster = (*application.Service)(nil)
)
