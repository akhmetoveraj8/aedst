// Package api is the integrity module's public boundary: verifying a Google
// Play Integrity token. The module publishes no events and owns one table
// (integrity.verified_tokens, replay protection).
package api

import (
	"context"

	"github.com/aedst/server/internal/modules/integrity/application"
	"github.com/aedst/server/internal/modules/integrity/domain"
)

type (
	VerifyInput = application.VerifyInput
	Result      = application.Result
	Reason      = domain.Reason
	Evidence    = domain.Evidence
)

// RequestHash is the request-binding convention clients must follow; see domain.RequestHash.
func RequestHash(action string, payload []byte) string { return domain.RequestHash(action, payload) }

// Service verifies Play Integrity tokens for an authenticated caller.
type Service interface {
	Verify(ctx context.Context, in VerifyInput) (Result, error)
}

var _ Service = (*application.Service)(nil)
