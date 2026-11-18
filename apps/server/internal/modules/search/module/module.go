// Package module registers the search module with the composition root
// (internal/platform/modulekit). Search is a projection of tasks/media events
// (schema search).
package module

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
	"google.golang.org/protobuf/reflect/protoreflect"

	searchv1 "github.com/aedst/server/gen/go/aedst/search/v1"
	searchv1connect "github.com/aedst/server/gen/go/aedst/search/v1/searchv1connect"
	mediaapi "github.com/aedst/server/internal/modules/media/api"
	searchapi "github.com/aedst/server/internal/modules/search/api"
	"github.com/aedst/server/internal/modules/search/application"
	"github.com/aedst/server/internal/modules/search/infrastructure/events"
	"github.com/aedst/server/internal/modules/search/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/search/transport"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/retention"
)

const smallRequestBytes = 64 << 10

func init() {
	m := &searchModule{}
	modulekit.Register(modulekit.Module{
		Name:  "search",
		Files: []protoreflect.FileDescriptor{searchv1.File_aedst_search_v1_search_proto},
		Retention: func(env *modulekit.Env) []retention.Policy {
			return []retention.Policy{{
				// Tombstones must outlive the event redelivery window (River's
				// retry backoff), or a late old snapshot could resurrect a
				// deleted document.
				Name:      "search.tombstones",
				Retention: time.Duration(env.Config.Retention.TombstoneHours) * time.Hour,
				Purge:     postgres.NewRepository(env.JobsPoolFor("search")).PurgeTombstones,
			}}
		},
		Setup: m.setup,
		Mount: m.mount,
		// What infrastructure/events subscribes to; architecturetest keeps the two equal.
		Consumes: []modulekit.Consume{
			{EventType: tasksapi.TaskCreatedEventType, Consumer: "search.task_created"},
			{EventType: tasksapi.TaskUpdatedEventType, Consumer: "search.task_updated"},
			{EventType: tasksapi.TaskDeletedEventType, Consumer: "search.task_deleted"},
			{EventType: mediaapi.MediaReadyEventType, Consumer: "search.media_ready"},
			{EventType: mediaapi.MediaDeletedEventType, Consumer: "search.media_deleted"},
		},
	})
}

type searchModule struct{ svc searchapi.Service }

func (m *searchModule) setup(_ context.Context, env *modulekit.Env) error {
	events.Subscribe(env.Events, env.JobsPoolFor("search"), postgres.NewRepository(env.JobsPoolFor("search")))
	m.svc = application.NewService(postgres.NewRepository(readPool(env)))
	return nil
}

func (m *searchModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, searchv1connect.RegisterSearchServiceHandler, searchv1connect.SearchServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	return nil
}

// readPool is the search database when the module runs on its own
// (AEDST_DATABASE_URL_SEARCH), else the lag-tolerant read pool.
func readPool(env *modulekit.Env) *pgxpool.Pool {
	if p := env.PoolFor("search"); p != env.Pool {
		return p
	}
	return env.ReadPool
}
