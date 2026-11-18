package transport_test

import (
	"context"
	"testing"

	"connectrpc.com/connect/v2"

	notificationsv1 "github.com/aedst/server/gen/go/aedst/notifications/v1"
	"github.com/aedst/server/internal/modules/notifications/api"
	"github.com/aedst/server/internal/modules/notifications/transport"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type operator struct {
	key  string
	user *ids.ID
	got  api.Broadcast
	err  error
}

func (o *operator) BroadcastIdempotent(_ context.Context, key string, user *ids.ID, b api.Broadcast) (int64, error) {
	o.key, o.user, o.got = key, user, b
	return 4, o.err
}

func (o *operator) CountActiveDevices(context.Context) (int64, error) { return 11, nil }

func TestOperatorHandler_BroadcastToEveryoneAndToOneUser(t *testing.T) {
	o := &operator{}
	h := transport.NewOperatorHandler(o)

	res, err := h.OperatorBroadcast(context.Background(), &notificationsv1.OperatorBroadcastRequest{Title: "T", Body: "B", Link: "/x", IdempotencyKey: "audit-1"})
	if err != nil || res.GetRecipients() != 4 {
		t.Fatalf("broadcast = %+v, %v", res, err)
	}
	if o.user != nil || o.key != "audit-1" || o.got != (api.Broadcast{Title: "T", Body: "B", Link: "/x"}) {
		t.Errorf("operator saw user %v key %q %+v", o.user, o.key, o.got)
	}

	user := ids.New()
	if _, err := h.OperatorBroadcast(context.Background(), &notificationsv1.OperatorBroadcastRequest{UserId: user.String(), Title: "T", IdempotencyKey: "audit-2"}); err != nil {
		t.Fatal(err)
	}
	if o.user == nil || *o.user != user {
		t.Errorf("user = %v, want %v", o.user, user)
	}
}

func TestOperatorHandler_ErrorsAndCount(t *testing.T) {
	o := &operator{err: sharederrors.Validation("notifications", "title must not be empty")}
	h := transport.NewOperatorHandler(o)

	if _, err := h.OperatorBroadcast(context.Background(), &notificationsv1.OperatorBroadcastRequest{IdempotencyKey: "k"}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("Validation maps to %v", connect.CodeOf(err))
	}
	if _, err := h.OperatorBroadcast(context.Background(), &notificationsv1.OperatorBroadcastRequest{UserId: "nope", IdempotencyKey: "k"}); connect.CodeOf(err) != connect.CodeInvalidArgument {
		t.Errorf("a malformed user id maps to %v", connect.CodeOf(err))
	}
	res, err := h.CountAllActiveDevices(context.Background(), &notificationsv1.CountAllActiveDevicesRequest{})
	if err != nil || res.GetDevices() != 11 {
		t.Errorf("count = %+v, %v", res, err)
	}
}
