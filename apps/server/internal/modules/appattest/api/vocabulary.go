package api

import "github.com/aedst/server/internal/modules/appattest/domain"

// Environment and failure vocabulary re-exported for the transport layer, which may
// import only api (architecturetest.TestLayersOnlyImportInward).
const (
	EnvironmentProduction  = domain.EnvironmentProduction
	EnvironmentDevelopment = domain.EnvironmentDevelopment
)

const (
	ReasonChallengeInvalid      = domain.ReasonChallengeInvalid
	ReasonBundleNotAllowed      = domain.ReasonBundleNotAllowed
	ReasonAttestationMalformed  = domain.ReasonAttestationMalformed
	ReasonCertificateChain      = domain.ReasonCertificateChain
	ReasonNonceMismatch         = domain.ReasonNonceMismatch
	ReasonKeyIDMismatch         = domain.ReasonKeyIDMismatch
	ReasonAppIDMismatch         = domain.ReasonAppIDMismatch
	ReasonCounterNotZero        = domain.ReasonCounterNotZero
	ReasonAAGUIDInvalid         = domain.ReasonAAGUIDInvalid
	ReasonEnvironmentNotAllowed = domain.ReasonEnvironmentNotAllowed
	ReasonKeyAlreadyEnrolled    = domain.ReasonKeyAlreadyEnrolled
	ReasonKeyUnknown            = domain.ReasonKeyUnknown
	ReasonAssertionMalformed    = domain.ReasonAssertionMalformed
	ReasonSignatureInvalid      = domain.ReasonSignatureInvalid
	ReasonCounterNotIncreasing  = domain.ReasonCounterNotIncreasing
)
