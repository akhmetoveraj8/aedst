package module

import (
	"github.com/aedst/server/internal/modules/admin/infrastructure/remote"
	"github.com/aedst/server/internal/platform/modulekit"
)

// serviceToken is the service identity of the admin.apply job: the bearer token
// it presents to a module that runs in another process, carrying the "internal"
// role of that module's operator service.
//
// It returns nil today, on purpose. A machine identity needs configuration this
// repository does not have yet (an OIDC client-credentials client for the job, an
// "internal" role granted to it in the identity provider, and AEDST_* settings for
// both: docs/content/decisions/0020-location-transparent-units.md, "Open"). Until
// then an operator action on a module hosted elsewhere is refused up front
// (remote.Tasks.Available) rather than queued to fail; reads work, because they
// forward the operator's own token. Everything else of the audit-first path is in
// place, so wiring the identity is replacing this function.
func serviceToken(*modulekit.Env) remote.TokenSource { return nil }
