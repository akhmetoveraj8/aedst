// Package module registers the integrity module (Google Play Integrity) with
// the composition root (internal/platform/modulekit). Disabled by default:
// without AEDST_INTEGRITY_ENABLED the service has no decoder and answers
// FAILED_PRECONDITION; nothing is contacted at startup, so a missing credential
// never fails a deploy that does not use it.
package module

import (
	"context"
	"time"

	"google.golang.org/protobuf/reflect/protoreflect"

	integrityv1 "github.com/aedst/server/gen/go/aedst/integrity/v1"
	integrityv1connect "github.com/aedst/server/gen/go/aedst/integrity/v1/integrityv1connect"
	integrityapi "github.com/aedst/server/internal/modules/integrity/api"
	"github.com/aedst/server/internal/modules/integrity/application"
	"github.com/aedst/server/internal/modules/integrity/domain"
	"github.com/aedst/server/internal/modules/integrity/infrastructure/google"
	"github.com/aedst/server/internal/modules/integrity/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/integrity/transport"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/retention"
)

const smallRequestBytes = 64 << 10

func init() {
	m := &integrityModule{}
	modulekit.Register(modulekit.Module{
		Name:      "integrity",
		Files:     []protoreflect.FileDescriptor{integrityv1.File_aedst_integrity_v1_integrity_proto},
		Retention: retentionPolicies,
		Setup:     m.setup,
		Mount:     m.mount,
	})
}

func retentionPolicies(env *modulekit.Env) []retention.Policy {
	in := env.Config.Integrity
	if !in.Enabled {
		return nil
	}
	// A claimed token must outlive the freshness window, or it could be replayed once its row is gone.
	return []retention.Policy{{
		Name:      "integrity.verified_tokens",
		Retention: time.Duration(in.MaxTokenAgeSeconds+in.MaxFutureSkewSeconds)*time.Second + 10*time.Minute,
		Purge:     postgres.NewRepository(env.JobsPoolFor("integrity")).PurgeOlderThan,
	}}
}

type integrityModule struct{ svc integrityapi.Service }

func (m *integrityModule) setup(ctx context.Context, env *modulekit.Env) error {
	svc, err := newService(ctx, env)
	m.svc = svc
	return err
}

func (m *integrityModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, integrityv1connect.RegisterIntegrityServiceHandler, integrityv1connect.IntegrityServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	return nil
}

// newService builds the service. With the module disabled it returns one
// without a decoder (every call is FAILED_PRECONDITION) and builds no Google client.
func newService(ctx context.Context, env *modulekit.Env) (*application.Service, error) {
	in := env.Config.Integrity
	if !in.Enabled {
		return application.NewService(nil, nil, domain.Policy{}, env.Clock), nil
	}
	level, err := domain.ParseDeviceLevel(in.MinDeviceLevel)
	if err != nil {
		return nil, err
	}
	policy := domain.Policy{
		AllowedPackages:       in.AllowedPackages,
		MaxAge:                time.Duration(in.MaxTokenAgeSeconds) * time.Second,
		MaxFutureSkew:         time.Duration(in.MaxFutureSkewSeconds) * time.Second,
		MinDeviceLevel:        level,
		RequirePlayRecognized: in.RequirePlayRecognized,
		RequireLicensed:       in.RequireLicensed,
		AllowTestingResponses: in.AllowTestingResponses,
	}
	if err := policy.Validate(); err != nil {
		return nil, err
	}
	decoder, err := google.NewDecoder(ctx, google.Config{
		CredentialsJSON: in.CredentialsJSON,
		CredentialsFile: in.CredentialsFile,
		Timeout:         time.Duration(in.TimeoutSeconds) * time.Second,
	})
	if err != nil {
		return nil, err
	}
	var opts []application.Option
	if in.RateLimitPerMinute > 0 {
		opts = append(opts, application.WithLimiter(env.RateLimiter, in.RateLimitPerMinute))
	}
	return application.NewService(decoder, postgres.NewRepository(env.PoolFor("integrity")), policy, env.Clock, opts...), nil
}
