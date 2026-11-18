package module

import (
	"context"

	mediav1 "github.com/aedst/server/gen/go/aedst/media/v1"
	mediav1connect "github.com/aedst/server/gen/go/aedst/media/v1/mediav1connect"
	mediaapi "github.com/aedst/server/internal/modules/media/api"
	"github.com/aedst/server/internal/platform/modulekit"
)

// Roles that may call MediaOperatorService: the human operator roles of the identity
// provider (the admin module forwards the operator's token) and the machine identity.
const (
	roleAdmin    = "admin"
	roleSupport  = "support"
	roleAuditor  = "auditor"
	roleInternal = "internal"
)

// operatorRoles is the built-in role policy of MediaOperatorService: read-only, so
// every operator role may read; ordinary users never can. AEDST_ROLE_POLICY
// replaces an entry for the same key.
func operatorRoles() map[string][]string {
	return map[string][]string{"/" + mediav1connect.MediaOperatorServiceName + "/*": {roleAdmin, roleSupport, roleAuditor, roleInternal}}
}

// remote binds what other units may ask of media (the operator totals) to its
// Connect client, for a process that does not host media (AEDST_MODULE_MEDIA_URL).
// The caller's own token is forwarded, so the totals can only be read on behalf of
// an authenticated operator.
func remote(env *modulekit.Env, target modulekit.RemoteTarget) error {
	client := mediav1connect.NewMediaOperatorServiceClient(modulekit.NewClient(target))
	modulekit.Provide[mediaapi.Stats](env, remoteStats{client: client})
	return nil
}

type remoteStats struct {
	client mediav1connect.MediaOperatorServiceClient
}

func (r remoteStats) Totals(ctx context.Context) (count, bytes int64, err error) {
	res, err := r.client.GetTotals(ctx, &mediav1.GetTotalsRequest{})
	if err != nil {
		return 0, 0, modulekit.ErrorFromConnect("media.Totals", err)
	}
	return res.GetCount(), res.GetBytes(), nil
}

var _ mediaapi.Stats = remoteStats{}
