// Package module registers the notifications module with the composition root
// (internal/platform/modulekit): it consumes tasks/media events, serves the
// inbox, the push-device registry and preferences, and delivers push from River.
package module

import (
	"context"
	"time"

	"github.com/riverqueue/river"
	"google.golang.org/protobuf/reflect/protoreflect"

	notificationsv1 "github.com/aedst/server/gen/go/aedst/notifications/v1"
	notificationsv1connect "github.com/aedst/server/gen/go/aedst/notifications/v1/notificationsv1connect"
	notificationsapi "github.com/aedst/server/internal/modules/notifications/api"
	"github.com/aedst/server/internal/modules/notifications/application"
	"github.com/aedst/server/internal/modules/notifications/infrastructure/events"
	"github.com/aedst/server/internal/modules/notifications/infrastructure/jobs"
	"github.com/aedst/server/internal/modules/notifications/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/notifications/transport"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/retention"
)

// smallRequestBytes caps one request message: notification requests are small
// metadata.
const smallRequestBytes = 64 << 10

func init() {
	m := &notificationsModule{}
	modulekit.Register(modulekit.Module{
		Name:      "notifications",
		Files:     []protoreflect.FileDescriptor{notificationsv1.File_aedst_notifications_v1_notifications_proto},
		Retention: retentionPolicies,
		Setup:     m.setup,
		Mount:     m.mount,
	})
}

func retentionPolicies(env *modulekit.Env) []retention.Policy {
	repo := postgres.NewRepository(env.JobsPool, nil)
	return []retention.Policy{
		{
			Name:      "notifications.notifications",
			Retention: time.Duration(env.Config.Retention.NotificationDays) * 24 * time.Hour,
			Purge:     repo.PurgeOlderThan,
		},
		{
			Name:      "notifications.push_devices",
			Retention: 30 * 24 * time.Hour, // disabled devices
			Purge:     repo.PurgeDisabledDevices,
		},
	}
}

type notificationsModule struct{ svc notificationsapi.Service }

func (m *notificationsModule) setup(_ context.Context, env *modulekit.Env) error {
	repo := postgres.NewRepository(env.Pool, env.Jobs)
	consumerRepo := postgres.NewRepository(env.JobsPool, env.Jobs)
	events.Subscribe(env.Events, env.JobsPool, consumerRepo)
	river.AddWorker(env.Workers, jobs.NewFanOutWorker(consumerRepo, env.Logger))
	river.AddWorker(env.Workers, jobs.NewDeviceWorker(consumerRepo, env.Dispatcher, env.Logger))
	svc := application.NewService(repo, env.Clock, application.WithWebPushPublicKey(env.WebPushKey))
	m.svc = svc
	modulekit.Provide[notificationsapi.Broadcaster](env, svc)
	return nil
}

func (m *notificationsModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, notificationsv1connect.RegisterNotificationsServiceHandler, notificationsv1connect.NotificationsServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	return nil
}
