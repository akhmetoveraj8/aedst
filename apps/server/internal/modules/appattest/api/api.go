// Package api is the appattest module's public boundary: issuing challenges,
// enrolling Apple App Attest keys and verifying assertions. The module
// publishes no events and owns two tables (appattest.challenges, appattest.keys).
package api

import (
	"context"

	"github.com/aedst/server/internal/modules/appattest/application"
	"github.com/aedst/server/internal/modules/appattest/domain"
	"github.com/aedst/server/internal/shared/ids"
)

type (
	Challenge       = application.Challenge
	EnrollInput     = application.EnrollInput
	EnrollResult    = application.EnrollResult
	AssertionInput  = application.AssertionInput
	AssertionResult = application.AssertionResult
	Reason          = domain.Reason
	Environment     = domain.Environment
)

// ClientDataHash is the convention clients must follow for assertions; see domain.ClientData.
func ClientDataHash(action string, payload []byte) [32]byte {
	return domain.ClientDataHash(action, payload)
}

// Service verifies App Attest evidence for an authenticated caller.
type Service interface {
	CreateChallenge(ctx context.Context, userID ids.ID) (Challenge, error)
	Enroll(ctx context.Context, in EnrollInput) (EnrollResult, error)
	VerifyAssertion(ctx context.Context, in AssertionInput) (AssertionResult, error)
}

var _ Service = (*application.Service)(nil)
