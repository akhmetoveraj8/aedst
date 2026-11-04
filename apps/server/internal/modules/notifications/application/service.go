package application

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/notifications/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

const (
	// MaxDevicesPerUser bounds the push fan-out (and abuse of the registry).
	MaxDevicesPerUser = 20
	// UnreadCountCap bounds the badge query; clients show "99+" beyond it.
	UnreadCountCap = 1000
)

type Service struct {
	repo    Repository
	clock   sharedtime.Clock
	webPush string
}

// Option customises Service.
type Option func(*Service)

// WithWebPushPublicKey publishes the VAPID public key through GetWebPushConfig.
func WithWebPushPublicKey(key string) Option { return func(s *Service) { s.webPush = key } }

func NewService(repo Repository, clock sharedtime.Clock, opts ...Option) *Service {
	s := &Service{repo: repo, clock: clock}
	for _, o := range opts {
		o(s)
	}
	return s
}

// ListNotifications returns one page of userID's feed, newest first. token is
// the opaque cursor from the previous page ("" for the first).
func (s *Service) ListNotifications(ctx context.Context, userID ids.ID, unreadOnly bool, limit int32, token string) (ListResult, error) {
	sort := SortToken
	if unreadOnly {
		sort = UnreadSortToken
	}
	after, err := pagination.Decode(token, sort)
	if err != nil {
		return ListResult{}, sharederrors.Validation("notifications.ListNotifications", "invalid page token")
	}
	return s.repo.List(ctx, ListParams{UserID: userID, UnreadOnly: unreadOnly, Limit: int(pagination.ClampLimit(limit)), After: after})
}

func (s *Service) GetUnreadCount(ctx context.Context, userID ids.ID) (int, error) {
	return s.repo.CountUnread(ctx, userID, UnreadCountCap)
}

// MarkRead marks userID's notifications read. Idempotent.
func (s *Service) MarkRead(ctx context.Context, userID ids.ID, notificationIDs ...ids.ID) error {
	if len(notificationIDs) == 0 {
		return sharederrors.Validation("notifications.MarkRead", "no ids")
	}
	return s.repo.MarkRead(ctx, userID, notificationIDs, s.clock.Now())
}

func (s *Service) MarkAllRead(ctx context.Context, userID ids.ID) (int, error) {
	return s.repo.MarkAllRead(ctx, userID, s.clock.Now())
}

// RegisterPushDevice registers (or refreshes) one installation's push channel.
func (s *Service) RegisterPushDevice(ctx context.Context, userID ids.ID, platform domain.Platform, token, endpoint, p256dh, auth, apnsTopic string, apnsSandbox bool, name, locale string) (ids.ID, error) {
	device, err := domain.NewDevice(userID, platform, token, endpoint, p256dh, auth, apnsTopic, apnsSandbox, name, locale, s.clock.Now())
	if err != nil {
		return ids.Nil, err
	}
	n, err := s.repo.CountActiveDevices(ctx, userID)
	if err != nil {
		return ids.Nil, err
	}
	if n >= MaxDevicesPerUser {
		// Re-registering an existing address is still allowed by the upsert,
		// but a new one beyond the cap is refused.
		return ids.Nil, sharederrors.Validation("notifications.RegisterPushDevice", "too many push devices; unregister an old one first")
	}
	return s.repo.UpsertDevice(ctx, device)
}

func (s *Service) UnregisterPushDevice(ctx context.Context, userID, deviceID ids.ID) error {
	return s.repo.UnregisterDevice(ctx, userID, deviceID, s.clock.Now())
}

// WebPushPublicKey is "" when Web Push is not configured.
func (s *Service) WebPushPublicKey() string { return s.webPush }

func (s *Service) GetPreferences(ctx context.Context, userID ids.ID) (domain.Preferences, error) {
	return s.repo.GetPreferences(ctx, userID)
}

func (s *Service) UpdatePreferences(ctx context.Context, userID ids.ID, p domain.Preferences) (domain.Preferences, error) {
	return s.repo.SavePreferences(ctx, userID, p, s.clock.Now())
}

// BroadcastTx sends a SYSTEM notification inside the caller's transaction
// (admin audit). userID nil means every user this module knows.
func (s *Service) BroadcastTx(ctx context.Context, tx pgx.Tx, userID *ids.ID, b domain.Broadcast) (int64, error) {
	if err := b.Validate(); err != nil {
		return 0, err
	}
	return s.repo.BroadcastTx(ctx, tx, ids.New(), userID, b, s.clock.Now())
}

func (s *Service) CountActiveDevices(ctx context.Context) (int64, error) {
	return s.repo.CountAllActiveDevices(ctx)
}
