// Package module registers the admin module with the composition root
// (internal/platform/modulekit). Admin composes the other modules through their
// api/ packages, so it requires them and is set up last. Operator RPCs stay
// closed without any configuration: the module's built-in role policy.
package module

import (
	"context"
	"time"

	"google.golang.org/protobuf/reflect/protoreflect"

	adminv1 "github.com/aedst/server/gen/go/aedst/admin/v1"
	adminv1connect "github.com/aedst/server/gen/go/aedst/admin/v1/adminv1connect"
	adminapi "github.com/aedst/server/internal/modules/admin/api"
	"github.com/aedst/server/internal/modules/admin/application"
	"github.com/aedst/server/internal/modules/admin/infrastructure/postgres"
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
				Purge:     postgres.NewRepository(env.JobsPool, env.JobStats, env.Clock).Purge, // background work: jobs pool
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
		m.r = postgres.NewRepository(env.Pool, env.JobStats, env.Clock)
	}
	return m.r
}

func (m *adminModule) setup(_ context.Context, env *modulekit.Env) error {
	tasks, err := modulekit.Require[tasksapi.AdminService](env)
	if err != nil {
		return err
	}
	notifications, err := modulekit.Require[notificationsapi.Broadcaster](env)
	if err != nil {
		return err
	}
	media, err := modulekit.Require[mediaapi.Stats](env)
	if err != nil {
		return err
	}
	repo := m.repo(env)
	m.svc = application.NewService(application.Deps{
		Tasks:         tasks,
		Notifications: notifications,
		Media:         media,
		Platform:      repo,
		Audit:         repo,
		Tx:            repo,
		Clock:         env.Clock,
	})
	return nil
}

func (m *adminModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, adminv1connect.RegisterAdminServiceHandler, adminv1connect.AdminServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	return nil
}
