// Package module registers the tasks module with the composition root
// (internal/platform/modulekit). It is the reference module
// (docs/content/server/modules.md): the reminder job is enqueued inside the
// task's own transaction (InsertTx on the request pool's tx), so it exists iff
// the change committed.
//
// The module is split into features (features/core, completion, reminders,
// operator); this package is the only one that imports them (compose.go).
package module

import (
	"context"
	"time"

	"github.com/riverqueue/river"
	"google.golang.org/protobuf/reflect/protoreflect"

	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	corepg "github.com/aedst/server/internal/modules/tasks/features/core/infrastructure/postgres"
	operatorapp "github.com/aedst/server/internal/modules/tasks/features/operator/application"
	operatortransport "github.com/aedst/server/internal/modules/tasks/features/operator/transport"
	remindersjobs "github.com/aedst/server/internal/modules/tasks/features/reminders/infrastructure/jobs"
	"github.com/aedst/server/internal/platform/modulekit"
)

// requestBytes caps one TasksService request message (title/description/search are small).
const requestBytes = 64 << 10

func init() {
	m := &tasksModule{}
	modulekit.Register(modulekit.Module{
		Name:   "tasks",
		Files:  []protoreflect.FileDescriptor{tasksv1.File_aedst_tasks_v1_tasks_proto, tasksv1.File_aedst_tasks_v1_tasks_operator_proto},
		Roles:  operatorRoles(),
		Setup:  m.setup,
		Mount:  m.mount,
		Remote: remote,
	})
}

type tasksModule struct {
	svc   tasksapi.Service
	admin tasksapi.AdminService
	ops   tasksapi.OperatorService
}

func (m *tasksModule) setup(_ context.Context, env *modulekit.Env) error {
	// A unit asks for its pools, River client and publisher by name, never Env.Pool /
	// Env.Jobs: with AEDST_DATABASE_URL_TASKS they are its own database's, and the
	// transaction a reminder or an event is inserted in is the one that holds its row.
	scheduler := remindersjobs.NewScheduler(env.JobsFor("tasks"), time.Duration(env.Config.Tasks.DueSoonLeadMinutes)*time.Minute)
	repos := newRepositories(env.PoolFor("tasks"), env.JobsPoolFor("tasks"), env.PublisherFor("tasks"), env.Clock, corepg.WithReminders(scheduler))
	stats := newStatsCache(env.Cache, env.Logger)
	m.svc = cachedService{Service: newService(repos, env.Clock), stats: stats}
	modulekit.Provide[tasksapi.Service](env, m.svc)
	modulekit.Provide[tasksapi.Ownership](env, tasksapi.NewOwnership(m.svc))
	adminSvc := cachedOperator{AdminService: operatorapp.NewAdminService(repos.operatorRepo), stats: stats}
	m.admin, m.ops = adminSvc, adminSvc
	modulekit.Provide[tasksapi.AdminService](env, adminSvc)
	modulekit.Provide[tasksapi.OperatorService](env, adminSvc)
	// The reminder worker runs on the jobs pool and publishes TaskDueSoon
	// through the same publisher.
	river.AddWorker(env.Workers, remindersjobs.NewDueReminderWorker(repos.remindersRepo, env.Logger))
	return nil
}

func (m *tasksModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, tasksv1connect.RegisterTasksServiceHandler, newTasksHandler(m.svc), requestBytes)
	modulekit.Mount(mt, tasksv1connect.RegisterTasksOperatorServiceHandler, tasksv1connect.TasksOperatorServiceHandler(operatortransport.NewOperatorHandler(m.admin, m.ops)), requestBytes)
	return nil
}
