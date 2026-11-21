// Package module registers the webhooks module with the composition root
// (internal/platform/modulekit): the operator API over the endpoint registry
// and the delivery log, the fan-out of integration events to endpoints, and the
// River worker that sends the signed deliveries (internal/platform/webhooks).
//
// Disabled by default: without AEDST_WEBHOOKS_ENABLED the service answers
// FAILED_PRECONDITION, no event is subscribed to (so nothing is fanned out) and
// a delivery job left in the queue is cancelled instead of sent.
package module

import (
	"context"
	"fmt"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"google.golang.org/protobuf/reflect/protoreflect"

	webhooksv1 "github.com/aedst/server/gen/go/aedst/webhooks/v1"
	webhooksv1connect "github.com/aedst/server/gen/go/aedst/webhooks/v1/webhooksv1connect"
	webhooksapi "github.com/aedst/server/internal/modules/webhooks/api"
	"github.com/aedst/server/internal/modules/webhooks/application"
	"github.com/aedst/server/internal/modules/webhooks/infrastructure/delivery"
	"github.com/aedst/server/internal/modules/webhooks/infrastructure/events"
	"github.com/aedst/server/internal/modules/webhooks/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/webhooks/infrastructure/secretbox"
	"github.com/aedst/server/internal/modules/webhooks/transport"
	"github.com/aedst/server/internal/platform/config"
	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/retention"
	platformwebhooks "github.com/aedst/server/internal/platform/webhooks"
)

const (
	name = "webhooks"
	// smallRequestBytes caps one request message: every request is small metadata.
	smallRequestBytes = 64 << 10
	// redeliverPerMinute is the built-in per-user budget of RedeliverDelivery,
	// the one RPC that causes an outbound request (AEDST_PROCEDURE_RATE_LIMITS
	// overrides it).
	redeliverPerMinute = 60
)

func init() {
	m := &webhooksModule{}
	modulekit.Register(modulekit.Module{
		Name:  "webhooks",
		Files: []protoreflect.FileDescriptor{webhooksv1.File_aedst_webhooks_v1_webhooks_proto},
		// Operator surface: closed to everyone but admin without any configuration.
		// An entry for the same key in AEDST_ROLE_POLICY replaces it.
		Roles: map[string][]string{"/" + webhooksv1connect.WebhooksServiceName + "/*": {"admin"}},
		RateLimits: func(config.Config) map[string]httpserver.ProcedureLimit {
			return map[string]httpserver.ProcedureLimit{
				webhooksv1connect.WebhooksServiceRedeliverDeliveryProcedure: {PerMinute: redeliverPerMinute},
			}
		},
		Retention: retentionPolicies,
		Setup:     m.setup,
		Mount:     m.mount,
		Consumes:  consumes,
	})
}

func retentionPolicies(env *modulekit.Env) []retention.Policy {
	cfg := env.Config.Webhooks
	if !cfg.Enabled {
		return nil
	}
	return []retention.Policy{{
		Name:      "webhooks.deliveries",
		Retention: time.Duration(cfg.DeliveryRetentionDays) * 24 * time.Hour,
		Purge:     postgres.NewRepository(env.JobsPoolFor(name), nil).PurgeDeliveries, // background work: jobs pool
	}}
}

type webhooksModule struct{ svc webhooksapi.Service }

func (m *webhooksModule) setup(_ context.Context, env *modulekit.Env) error {
	cfg := env.Config.Webhooks
	if !cfg.Enabled {
		// Every process registers every worker (River validates job kinds on
		// insert); with no endpoint store a leftover job is cancelled.
		river.AddWorker(env.Workers, platformwebhooks.NewWorker(delivery.NoEndpoints{}, nil, env.Clock.Now))
		m.svc = application.Disabled{}
		return nil
	}
	keys, err := cfg.SecretKeys()
	if err != nil {
		return fmt.Errorf("webhooks: %w", err)
	}
	box, err := secretbox.New(keys.Current, keys.Keys)
	if err != nil {
		return fmt.Errorf("webhooks: %w", err)
	}

	// Background side (fan-out, worker): the jobs pool.
	jobsPool := env.JobsPoolFor(name)
	jobsRepo := postgres.NewRepository(jobsPool, nil)
	inTx := func(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error {
		return database.WithTx(ctx, jobsPool, fn)
	}
	events.Subscribe(env.Events, inTx, jobsRepo, env.JobsFor(name), env.Clock)
	worker := platformwebhooks.NewWorker(
		delivery.NewEndpoints(jobsRepo, box),
		platformwebhooks.NewHTTPClient(platformwebhooks.ClientConfig{AllowedHosts: cfg.AllowedHosts}),
		env.Clock.Now,
	).WithRecorder(delivery.NewRecorder(jobsRepo, env.Clock, cfg.DisableAfterFailures))
	river.AddWorker(env.Workers, worker)

	// Request side (operator API): the request pool.
	m.svc = application.NewService(postgres.NewRepository(env.PoolFor(name), env.JobsFor(name)), box, env.Clock, OfferedEventTypes())
	return nil
}

func (m *webhooksModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, webhooksv1connect.RegisterWebhooksServiceHandler, webhooksv1connect.WebhooksServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	return nil
}
