// Package module registers the search module with the composition root
// (internal/platform/modulekit). Search is a projection of tasks/media events
// (schema search).
package module

import (
	"context"
	"time"

	"google.golang.org/protobuf/reflect/protoreflect"

	searchv1 "github.com/aedst/server/gen/go/aedst/search/v1"
	searchv1connect "github.com/aedst/server/gen/go/aedst/search/v1/searchv1connect"
	searchapi "github.com/aedst/server/internal/modules/search/api"
	"github.com/aedst/server/internal/modules/search/application"
	"github.com/aedst/server/internal/modules/search/infrastructure/events"
	"github.com/aedst/server/internal/modules/search/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/search/transport"
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
				Purge:     postgres.NewRepository(env.JobsPool).PurgeTombstones,
			}}
		},
		Setup: m.setup,
		Mount: m.mount,
	})
}

type searchModule struct{ svc searchapi.Service }

func (m *searchModule) setup(_ context.Context, env *modulekit.Env) error {
	events.Subscribe(env.Events, env.JobsPool, postgres.NewRepository(env.JobsPool))
	m.svc = application.NewService(postgres.NewRepository(env.ReadPool))
	return nil
}

func (m *searchModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, searchv1connect.RegisterSearchServiceHandler, searchv1connect.SearchServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	return nil
}
