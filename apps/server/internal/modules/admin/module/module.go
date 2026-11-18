// Package module registers the admin module with the composition root
// (internal/platform/modulekit). Admin composes the other modules through their
// api/ packages, so it requires them and is set up last. Operator RPCs stay
// closed without any configuration: the module's built-in role policy.
package module

import (
	"context"
	"errors"
	"time"

	"github.com/riverqueue/river"
	"google.golang.org/protobuf/reflect/protoreflect"

	adminv1 "github.com/aedst/server/gen/go/aedst/admin/v1"
	adminv1connect "github.com/aedst/server/gen/go/aedst/admin/v1/adminv1connect"
	adminapi "github.com/aedst/server/internal/modules/admin/api"
	"github.com/aedst/server/internal/modules/admin/application"
	"github.com/aedst/server/internal/modules/admin/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/admin/infrastructure/remote"
	adminjobs "github.com/aedst/server/internal/modules/admin/jobs"
	"github.com/aedst/server/internal/modules/admin/transport"
	mediaapi "github.com/aedst/server/internal/modules/media/api"
	notificationsapi "github.com/aedst/server/internal/modules/notifications/api"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/retention"
)

const smallRequestBytes = 64 << 10

func init() {
	m := &adminModule{}
	modulekit.Register(modulekit.Module{
		Name:     "admin",
		Requires: []string{"media", "notifications", "tasks"},
		Files:    []protoreflect.FileDescriptor{adminv1.File_aedst_admin_v1_admin_proto},
		// An empty AEDST_ROLE_POLICY must not open AdminService to every signed-in
		// user. An entry for the same key in AEDST_ROLE_POLICY replaces it.
		Roles: DefaultRoles(),
		Retention: func(env *modulekit.Env) []retention.Policy {
			return []retention.Policy{{
				Name:      "admin.audit_log",
				Retention: time.Duration(env.Config.Retention.AuditDays) * 24 * time.Hour,
				Purge:     postgres.NewRepository(env.JobsPoolFor("admin"), env.JobStats, env.Clock).Purge, // background work: jobs pool
			}}
		},
		Setup: m.setup,
		Mount: m.mount,
	})
}

type adminModule struct {
	r   *postgres.Repository
	svc adminapi.Service
}

// repo is the admin repository on the request pool: audit log, platform stats
// and the transaction runner. Built once; retention and Setup share it.
func (m *adminModule) repo(env *modulekit.Env) *postgres.Repository {
	if m.r == nil {
		m.r = postgres.NewRepository(env.PoolFor("admin"), env.JobStats, env.Clock)
	}
	return m.r
}

// setup picks, per module it composes, between the two ways of reaching it:
//
//   - hosted in this process (modulekit.Lookup finds its api): the in-process
//     transactional path, unchanged: the module's *Tx method runs in the audit
//     entry's own transaction;
//   - hosted elsewhere (AEDST_MODULE_<NAME>_URL): the module's operator client, and
//     the audit-first path (pending entry + admin.apply job) for mutations.
//
// Media is optional either way: without it the overview omits media.
func (m *adminModule) setup(ctx context.Context, env *modulekit.Env) error {
	repo := m.repo(env)
	repo.UseJobs(env.JobsFor("admin"))
	token := serviceToken(ctx, env)

	var tasksOps tasksapi.OperatorService
	tasks, ok := modulekit.Lookup[tasksapi.AdminService](env)
	if ok && env.PoolFor("tasks") != env.PoolFor("admin") {
		// Hosted here but on another database: no transaction can span the audit row
		// and the task, so take the audit-first path through the in-process operator API.
		if tasksOps, ok = modulekit.Lookup[tasksapi.OperatorService](env); !ok {
			return errors.New("admin: tasks runs on its own database but provides no operator service")
		}
		ok = true
	}
	if !ok {
		url := env.Config.Topology.Remote["tasks"]
		if url == "" {
			return errors.New("admin: tasks is neither hosted here nor reachable (set AEDST_MODULE_TASKS_URL)")
		}
		rt := remote.NewTasks(modulekit.RemoteTarget{Name: "tasks", BaseURL: url}, token)
		tasks, tasksOps = rt, rt
	}
	var notificationsOps notificationsapi.Operator
	notifications, ok := modulekit.Lookup[notificationsapi.Broadcaster](env)
	if ok && env.PoolFor("notifications") != env.PoolFor("admin") {
		if notificationsOps, ok = modulekit.Lookup[notificationsapi.Operator](env); !ok {
			return errors.New("admin: notifications runs on its own database but provides no operator service")
		}
		ok = true
	}
	if !ok {
		url := env.Config.Topology.Remote["notifications"]
		if url == "" {
			return errors.New("admin: notifications is neither hosted here nor reachable (set AEDST_MODULE_NOTIFICATIONS_URL)")
		}
		rn := remote.NewNotifications(modulekit.RemoteTarget{Name: "notifications", BaseURL: url}, token)
		notifications, notificationsOps = rn, rn
	}
	media, _ := modulekit.Lookup[mediaapi.Stats](env)

	// Every process registers every worker (River validates job kinds on insert).
	// It runs on the jobs pool, like every background worker.
	jobsRepo := postgres.NewRepository(env.JobsPoolFor("admin"), env.JobStats, env.Clock)
	applier := application.NewApplier(jobsRepo, tasksOps, notificationsOps, env.Clock)
	river.AddWorker(env.Workers, adminjobs.NewApplyWorker(applier))

	m.svc = application.NewService(application.Deps{
		Tasks:            tasks,
		Notifications:    notifications,
		TasksOps:         tasksOps,
		NotificationsOps: notificationsOps,
		Queue:            repo,
		Media:            media,
		Platform:         repo,
		Audit:            repo,
		Tx:               repo,
		Clock:            env.Clock,
	})
	return nil
}

func (m *adminModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, adminv1connect.RegisterAdminServiceHandler, adminv1connect.AdminServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	return nil
}
