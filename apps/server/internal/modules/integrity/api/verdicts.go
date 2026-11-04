package api

import "github.com/aedst/server/internal/modules/integrity/domain"

// Verdict vocabulary re-exported for the transport layer, which may import only api
// (architecturetest.TestLayersOnlyImportInward).
const (
	DeviceBasic   = domain.DeviceBasic
	DeviceDevice  = domain.DeviceDevice
	DeviceStrong  = domain.DeviceStrong
	DeviceVirtual = domain.DeviceVirtual

	AppPlayRecognized      = domain.AppPlayRecognized
	AppUnrecognizedVersion = domain.AppUnrecognizedVersion
	AppUnevaluated         = domain.AppUnevaluated

	AccountLicensed    = domain.AccountLicensed
	AccountUnlicensed  = domain.AccountUnlicensed
	AccountUnevaluated = domain.AccountUnevaluated
)

const (
	ReasonTokenUndecodable    = domain.ReasonTokenUndecodable
	ReasonRequestHashMismatch = domain.ReasonRequestHashMismatch
	ReasonTokenNotBound       = domain.ReasonTokenNotBound
	ReasonPackageMismatch     = domain.ReasonPackageMismatch
	ReasonTokenExpired        = domain.ReasonTokenExpired
	ReasonTokenFromFuture     = domain.ReasonTokenFromFuture
	ReasonDeviceNotTrusted    = domain.ReasonDeviceNotTrusted
	ReasonAppNotRecognized    = domain.ReasonAppNotRecognized
	ReasonNotLicensed         = domain.ReasonNotLicensed
	ReasonTestingResponse     = domain.ReasonTestingResponse
	ReasonTokenReplayed       = domain.ReasonTokenReplayed
)
