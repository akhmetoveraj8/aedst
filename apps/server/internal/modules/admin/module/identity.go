package module

import (
	"context"

	"github.com/aedst/server/internal/modules/admin/infrastructure/remote"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/serviceauth"
)

// serviceToken is the service identity of the admin.apply job: the bearer token
// it presents to a module that runs in another process, carrying the "internal"
// role of that module's operator service (ADR-0020 section 5).
//
// It is an OIDC client-credentials client configured with AEDST_SERVICE_IDENTITY_*
// (internal/platform/serviceauth); the identity provider grants that client the
// "internal" role. With no token URL configured it returns nil and an operator
// action on a module hosted elsewhere is refused up front (remote.Tasks.Available)
// rather than queued to fail; reads work either way, because they forward the
// operator's own token.
func serviceToken(ctx context.Context, env *modulekit.Env) remote.TokenSource {
	src := serviceauth.New(ctx, env.Config.ServiceIdentity, nil)
	if src == nil {
		return nil
	}
	return remote.TokenSource(src)
}
