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
	mediaapi "github.com/aedst/server/internal/modules/media/api"
	notificationsapi "github.com/aedst/server/internal/modules/notifications/api"
	"github.com/aedst/server/internal/modules/notifications/application"
	"github.com/aedst/server/internal/modules/notifications/infrastructure/events"
	"github.com/aedst/server/internal/modules/notifications/infrastructure/jobs"
	"github.com/aedst/server/internal/modules/notifications/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/notifications/transport"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
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
		Files:     []protoreflect.FileDescriptor{notificationsv1.File_aedst_notifications_v1_notifications_proto, notificationsv1.File_aedst_notifications_v1_notifications_operator_proto},
		Roles:     operatorRoles(),
		Retention: retentionPolicies,
		Setup:     m.setup,
		Mount:     m.mount,
		// Reaching notifications over the network needs no client-side binding of its own:
		// what other units ask of it (the operator surface) is consumed by the admin module,
		// which builds its client from AEDST_MODULE_NOTIFICATIONS_URL. The hook marks the
		// unit as remotely reachable for modulekit.Select.
		Remote: func(*modulekit.Env, modulekit.RemoteTarget) error { return nil },
		// What infrastructure/events subscribes to; architecturetest keeps the two equal.
		Consumes: []modulekit.Consume{
			{EventType: tasksapi.TaskCompletedEventType, Consumer: "notifications.task_completed"},
			{EventType: tasksapi.TaskDueSoonEventType, Consumer: "notifications.task_due_soon"},
			{EventType: mediaapi.MediaReadyEventType, Consumer: "notifications.media_ready"},
		},
	})
}

func retentionPolicies(env *modulekit.Env) []retention.Policy {
	repo := postgres.NewRepository(env.JobsPoolFor("notifications"), nil)
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

type notificationsModule struct {
	svc      notificationsapi.Service
	operator notificationsapi.Operator
}

func (m *notificationsModule) setup(_ context.Context, env *modulekit.Env) error {
	repo := postgres.NewRepository(env.PoolFor("notifications"), env.JobsFor("notifications"))
	consumerRepo := postgres.NewRepository(env.JobsPoolFor("notifications"), env.JobsFor("notifications"))
	events.Subscribe(env.Events, env.JobsPoolFor("notifications"), consumerRepo)
	river.AddWorker(env.Workers, jobs.NewFanOutWorker(consumerRepo, env.Logger))
	river.AddWorker(env.Workers, jobs.NewDeviceWorker(consumerRepo, env.Dispatcher, env.Logger))
	svc := application.NewService(repo, env.Clock, application.WithWebPushPublicKey(env.WebPushKey),
		application.WithWebPushHosts(env.Config.Push.WebPushHosts))
	m.svc = svc
	m.operator = svc
	modulekit.Provide[notificationsapi.Broadcaster](env, svc)
	modulekit.Provide[notificationsapi.Operator](env, svc)
	return nil
}

func (m *notificationsModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, notificationsv1connect.RegisterNotificationsServiceHandler, notificationsv1connect.NotificationsServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	modulekit.Mount(mt, notificationsv1connect.RegisterNotificationsOperatorServiceHandler, notificationsv1connect.NotificationsOperatorServiceHandler(transport.NewOperatorHandler(m.operator)), smallRequestBytes)
	return nil
}
