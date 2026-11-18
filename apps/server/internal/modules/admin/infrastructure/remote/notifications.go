package remote

import (
	"context"

	"github.com/jackc/pgx/v5"

	notificationsv1 "github.com/aedst/server/gen/go/aedst/notifications/v1"
	notificationsv1connect "github.com/aedst/server/gen/go/aedst/notifications/v1/notificationsv1connect"
	notificationsapi "github.com/aedst/server/internal/modules/notifications/api"
	"github.com/aedst/server/internal/platform/modulekit"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// Notifications is the notifications module reached over
// NotificationsOperatorService.
type Notifications struct {
	client notificationsv1connect.NotificationsOperatorServiceClient
	token  TokenSource
}

var (
	_ notificationsapi.Broadcaster = (*Notifications)(nil)
	_ notificationsapi.Operator    = (*Notifications)(nil)
)

// NewNotifications builds the client of the notifications module at target. token
// may be nil.
func NewNotifications(target modulekit.RemoteTarget, token TokenSource) *Notifications {
	return &Notifications{client: notificationsv1connect.NewNotificationsOperatorServiceClient(modulekit.NewClient(target)), token: token}
}

// Available reports whether mutations can run (a service identity exists).
func (n *Notifications) Available() error {
	if n.token == nil {
		return errNoIdentity()
	}
	return nil
}

// BroadcastTx cannot cross a process boundary: a transaction is not a value that
// can be sent. The service never calls it when the module is remote (it takes the
// audit-first path through BroadcastIdempotent).
func (n *Notifications) BroadcastTx(context.Context, pgx.Tx, *ids.ID, notificationsapi.Broadcast) (int64, error) {
	return 0, sharederrors.FailedPrecondition("admin.remote.BroadcastTx", "a transaction cannot span processes: use the audit-first path")
}

func (n *Notifications) CountActiveDevices(ctx context.Context) (int64, error) {
	res, err := n.client.CountAllActiveDevices(ctx, &notificationsv1.CountAllActiveDevicesRequest{})
	if err != nil {
		return 0, modulekit.ErrorFromConnect("admin.remote.CountActiveDevices", err)
	}
	return res.GetDevices(), nil
}

// BroadcastIdempotent is the audit-first mutation: idempotent on key (the audit
// entry id).
func (n *Notifications) BroadcastIdempotent(ctx context.Context, key string, userID *ids.ID, b notificationsapi.Broadcast) (int64, error) {
	ctx, err := asService(ctx, n.token)
	if err != nil {
		return 0, err
	}
	req := &notificationsv1.OperatorBroadcastRequest{Title: b.Title, Body: b.Body, Link: b.Link, IdempotencyKey: key}
	if userID != nil {
		req.UserId = userID.String()
	}
	res, err := n.client.OperatorBroadcast(ctx, req)
	if err != nil {
		return 0, modulekit.ErrorFromConnect("admin.remote.Broadcast", err)
	}
	return res.GetRecipients(), nil
}
