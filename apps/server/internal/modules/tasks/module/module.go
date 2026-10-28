// Package module registers the tasks module with the composition root
// (internal/platform/modulekit). It is the reference module
// (docs/content/server/modules.md): the reminder job is enqueued inside the
// task's own transaction (InsertTx on the request pool's tx), so it exists iff
// the change committed.
package module

import (
	"context"
	"time"

	"github.com/riverqueue/river"
	"google.golang.org/protobuf/reflect/protoreflect"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/application"
	jobsinfra "github.com/aedst/server/internal/modules/tasks/infrastructure/jobs"
	"github.com/aedst/server/internal/modules/tasks/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/tasks/jobs"
	"github.com/aedst/server/internal/modules/tasks/transport"
	"github.com/aedst/server/internal/platform/modulekit"
)

// requestBytes caps one TasksService request message (title/description/search are small).
const requestBytes = 64 << 10

func init() {
	m := &tasksModule{}
	modulekit.Register(modulekit.Module{
		Name:  "tasks",
		Files: []protoreflect.FileDescriptor{tasksv1.File_aedst_tasks_v1_tasks_proto},
		Setup: m.setup,
		Mount: m.mount,
	})
}

type tasksModule struct{ svc tasksapi.Service }

func (m *tasksModule) setup(_ context.Context, env *modulekit.Env) error {
	repo := postgres.NewRepository(env.Pool, env.Publisher, env.Clock,
		postgres.WithReminders(jobsinfra.NewScheduler(env.Jobs, time.Duration(env.Config.Tasks.DueSoonLeadMinutes)*time.Minute)))
	m.svc = application.NewService(repo, env.Clock)
	modulekit.Provide[tasksapi.Service](env, m.svc)
	modulekit.Provide[tasksapi.AdminService](env, application.NewAdminService(repo))
	// The reminder worker runs on the jobs pool and publishes TaskDueSoon
	// through the same publisher.
	river.AddWorker(env.Workers, jobs.NewDueReminderWorker(
		postgres.NewRepository(env.JobsPool, env.Publisher, env.Clock), env.Logger))
	return nil
}

func (m *tasksModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, tasksv1connect.RegisterTasksServiceHandler, tasksv1connect.TasksServiceHandler(transport.NewHandler(m.svc)), requestBytes)
	return nil
}
