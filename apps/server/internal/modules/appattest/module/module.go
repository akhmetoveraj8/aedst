// Package module registers the appattest module (Apple App Attest) with the
// composition root (internal/platform/modulekit). Disabled by default: without
// AEDST_APPATTEST_ENABLED the service has no verifier and answers
// FAILED_PRECONDITION. Nothing is contacted either way: verification is local
// computation against the embedded Apple root CA.
package module

import (
	"context"
	"time"

	"google.golang.org/protobuf/reflect/protoreflect"

	appattestv1 "github.com/aedst/server/gen/go/aedst/appattest/v1"
	appattestv1connect "github.com/aedst/server/gen/go/aedst/appattest/v1/appattestv1connect"
	appattestapi "github.com/aedst/server/internal/modules/appattest/api"
	"github.com/aedst/server/internal/modules/appattest/application"
	"github.com/aedst/server/internal/modules/appattest/domain"
	"github.com/aedst/server/internal/modules/appattest/infrastructure/apple"
	"github.com/aedst/server/internal/modules/appattest/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/appattest/transport"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/retention"
)

// requestBytes fits an App Attest attestation object (about 6 KB, up to 32 KB allowed).
const requestBytes = 64 << 10

func init() {
	m := &appattestModule{}
	modulekit.Register(modulekit.Module{
		Name:      "appattest",
		Files:     []protoreflect.FileDescriptor{appattestv1.File_aedst_appattest_v1_appattest_proto},
		Retention: retentionPolicies,
		Setup:     m.setup,
		Mount:     m.mount,
	})
}

func retentionPolicies(env *modulekit.Env) []retention.Policy {
	cfg := env.Config.AppAttest
	if !cfg.Enabled {
		return nil
	}
	return []retention.Policy{
		{
			Name:      "appattest.challenges",
			Retention: time.Hour, // challenges live 5 minutes; the row only has to outlive that
			Purge:     postgres.NewChallengeRepository(env.JobsPoolFor("appattest")).PurgeChallenges,
		},
		{
			Name:      "appattest.keys",
			Retention: time.Duration(cfg.KeyRetentionDays) * 24 * time.Hour,
			Purge:     postgres.NewKeyRepository(env.JobsPoolFor("appattest")).PurgeKeys,
		},
	}
}

type appattestModule struct{ svc appattestapi.Service }

func (m *appattestModule) setup(_ context.Context, env *modulekit.Env) error {
	svc, err := newService(env)
	m.svc = svc
	return err
}

func (m *appattestModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, appattestv1connect.RegisterAppAttestServiceHandler, appattestv1connect.AppAttestServiceHandler(transport.NewHandler(m.svc)), requestBytes)
	return nil
}

func newService(env *modulekit.Env) (*application.Service, error) {
	a := env.Config.AppAttest
	if !a.Enabled {
		return application.NewService(nil, nil, nil, nil, domain.Policy{}, env.Clock), nil
	}
	policy := domain.Policy{TeamID: a.TeamID, AllowedBundleIDs: a.AllowedBundleIDs, AllowDevelopment: a.AllowDevelopment}
	if err := policy.Validate(); err != nil {
		return nil, err
	}
	roots, err := apple.AppleRoots()
	if err != nil {
		return nil, err
	}
	verifier := apple.NewVerifier(roots, env.Clock)
	return application.NewService(
		verifier, verifier,
		postgres.NewChallengeRepository(env.PoolFor("appattest")), postgres.NewKeyRepository(env.PoolFor("appattest")),
		policy, env.Clock,
		application.WithLimiter(env.RateLimiter, a.RateLimitPerMinute, a.AssertionRateLimitPerMinute),
	), nil
}
