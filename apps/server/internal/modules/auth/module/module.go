// Package module registers the first-party auth module with the composition
// root (internal/platform/modulekit). AuthService is mounted only when
// AEDST_AUTH_FIRST_PARTY_ENABLED is set: with an external IdP as the system of
// record, clients authenticate against it directly and this server only
// verifies its tokens (the verifier is a platform component, not this module).
package module

import (
	"context"
	"time"

	"google.golang.org/protobuf/reflect/protoreflect"

	authv1 "github.com/aedst/server/gen/go/aedst/auth/v1"
	authv1connect "github.com/aedst/server/gen/go/aedst/auth/v1/authv1connect"
	authapi "github.com/aedst/server/internal/modules/auth/api"
	"github.com/aedst/server/internal/modules/auth/application"
	"github.com/aedst/server/internal/modules/auth/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/auth/infrastructure/ratelimit"
	"github.com/aedst/server/internal/modules/auth/infrastructure/security"
	"github.com/aedst/server/internal/modules/auth/infrastructure/tokens"
	"github.com/aedst/server/internal/modules/auth/transport"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/retention"
)

const smallRequestBytes = 64 << 10

func init() {
	m := &authModule{}
	modulekit.Register(modulekit.Module{
		Name:  "auth",
		Files: []protoreflect.FileDescriptor{authv1.File_aedst_auth_v1_auth_proto},
		// Registration/login/refresh happen before a client has a token.
		Public: []string{
			authv1connect.AuthServiceRegisterProcedure,
			authv1connect.AuthServiceLoginProcedure,
			authv1connect.AuthServiceRefreshTokenProcedure,
			authv1connect.AuthServiceLogoutProcedure,
		},
		Retention: func(env *modulekit.Env) []retention.Policy {
			if !env.Config.Auth.FirstPartyEnabled {
				return nil
			}
			return []retention.Policy{{
				Name:      "auth.sessions",
				Retention: time.Duration(env.Config.Retention.SessionHours) * time.Hour,
				Purge:     postgres.NewSessionRepository(env.JobsPool).PurgeDeadSessions,
			}}
		},
		Setup: m.setup,
		Mount: m.mount,
	})
}

type authModule struct{ svc authapi.Service }

// setup publishes the operator directory (admin composes it) and builds the
// service; both only exist with first-party auth.
func (m *authModule) setup(_ context.Context, env *modulekit.Env) error {
	cfg := env.Config
	if !cfg.Auth.FirstPartyEnabled {
		return nil
	}
	modulekit.Provide[authapi.Directory](env, application.NewDirectory(postgres.NewCredentialRepository(env.Pool)))

	opts := []application.Option{application.WithLogger(env.Logger)}
	if cfg.Auth.LoginRateLimitPerMinute > 0 {
		opts = append(opts, application.WithLoginLimiter(ratelimit.NewLoginLimiter(env.RateLimiter, cfg.Auth.LoginRateLimitPerMinute)))
	}
	hasher, err := security.NewArgon2idHasher()
	if err != nil {
		return err
	}
	m.svc = application.NewService(
		postgres.NewCredentialRepository(env.Pool),
		postgres.NewSessionRepository(env.Pool),
		tokens.NewAdapter(env.FirstParty),
		hasher,
		env.Clock,
		opts...,
	)
	return nil
}

func (m *authModule) mount(env *modulekit.Env, mt *modulekit.Mounter) error {
	if !env.Config.Auth.FirstPartyEnabled {
		return nil
	}
	modulekit.Mount(mt, authv1connect.RegisterAuthServiceHandler, authv1connect.AuthServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	return nil
}
