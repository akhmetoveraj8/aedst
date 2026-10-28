// Package transport implements IntegrityService over integrity/api.
package transport

import (
	"context"

	"google.golang.org/protobuf/types/known/timestamppb"

	integrityv1 "github.com/aedst/server/gen/go/aedst/integrity/v1"
	"github.com/aedst/server/internal/modules/integrity/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
)

type Handler struct {
	service api.Service
}

func NewHandler(service api.Service) *Handler { return &Handler{service: service} }

func (h *Handler) VerifyIntegrityToken(ctx context.Context, req *integrityv1.VerifyIntegrityTokenRequest) (*integrityv1.VerifyIntegrityTokenResponse, error) {
	identity, ok := platformauth.FromContext(ctx)
	if !ok {
		return nil, httpserver.ToConnectError(sharederrors.Unauthorized("integrity", "missing identity"))
	}
	msg := req
	res, err := h.service.Verify(ctx, api.VerifyInput{
		UserID:      identity.UserID,
		Token:       msg.GetIntegrityToken(),
		Action:      msg.GetAction(),
		Payload:     msg.GetPayload(),
		RequestHash: msg.GetRequestHash(),
		PackageName: msg.GetPackageName(),
	})
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	out := &integrityv1.VerifyIntegrityTokenResponse{
		Verified: res.Verified,
		Reason:   reasonToProto(res.Reason),
	}
	if res.Decoded {
		out.AppVerdict = appVerdictToProto(res.Evidence.AppVerdict)
		out.AccountVerdict = accountVerdictToProto(res.Evidence.AccountVerdict)
		for _, v := range res.Evidence.DeviceVerdicts {
			if dv := deviceVerdictToProto(v); dv != integrityv1.DeviceVerdict_DEVICE_VERDICT_UNSPECIFIED {
				out.DeviceVerdicts = append(out.DeviceVerdicts, dv)
			}
		}
		out.TokenIssuedAt = timestamppb.New(res.Evidence.IssuedAt)
	}
	if res.Verified {
		out.Action = msg.GetAction()
	}
	return out, nil
}

func reasonToProto(r api.Reason) integrityv1.FailureReason {
	switch r {
	case api.ReasonTokenUndecodable:
		return integrityv1.FailureReason_FAILURE_REASON_TOKEN_UNDECODABLE
	case api.ReasonRequestHashMismatch:
		return integrityv1.FailureReason_FAILURE_REASON_REQUEST_HASH_MISMATCH
	case api.ReasonTokenNotBound:
		return integrityv1.FailureReason_FAILURE_REASON_TOKEN_NOT_BOUND
	case api.ReasonPackageMismatch:
		return integrityv1.FailureReason_FAILURE_REASON_PACKAGE_MISMATCH
	case api.ReasonTokenExpired:
		return integrityv1.FailureReason_FAILURE_REASON_TOKEN_EXPIRED
	case api.ReasonTokenFromFuture:
		return integrityv1.FailureReason_FAILURE_REASON_TOKEN_FROM_FUTURE
	case api.ReasonDeviceNotTrusted:
		return integrityv1.FailureReason_FAILURE_REASON_DEVICE_NOT_TRUSTED
	case api.ReasonAppNotRecognized:
		return integrityv1.FailureReason_FAILURE_REASON_APP_NOT_RECOGNIZED
	case api.ReasonNotLicensed:
		return integrityv1.FailureReason_FAILURE_REASON_NOT_LICENSED
	case api.ReasonTestingResponse:
		return integrityv1.FailureReason_FAILURE_REASON_TESTING_RESPONSE
	case api.ReasonTokenReplayed:
		return integrityv1.FailureReason_FAILURE_REASON_TOKEN_REPLAYED
	default:
		return integrityv1.FailureReason_FAILURE_REASON_UNSPECIFIED
	}
}

func deviceVerdictToProto(v string) integrityv1.DeviceVerdict {
	switch v {
	case api.DeviceBasic:
		return integrityv1.DeviceVerdict_DEVICE_VERDICT_MEETS_BASIC_INTEGRITY
	case api.DeviceDevice:
		return integrityv1.DeviceVerdict_DEVICE_VERDICT_MEETS_DEVICE_INTEGRITY
	case api.DeviceStrong:
		return integrityv1.DeviceVerdict_DEVICE_VERDICT_MEETS_STRONG_INTEGRITY
	case api.DeviceVirtual:
		return integrityv1.DeviceVerdict_DEVICE_VERDICT_MEETS_VIRTUAL_INTEGRITY
	default:
		return integrityv1.DeviceVerdict_DEVICE_VERDICT_UNSPECIFIED
	}
}

func appVerdictToProto(v string) integrityv1.AppVerdict {
	switch v {
	case api.AppPlayRecognized:
		return integrityv1.AppVerdict_APP_VERDICT_PLAY_RECOGNIZED
	case api.AppUnrecognizedVersion:
		return integrityv1.AppVerdict_APP_VERDICT_UNRECOGNIZED_VERSION
	case api.AppUnevaluated:
		return integrityv1.AppVerdict_APP_VERDICT_UNEVALUATED
	default:
		return integrityv1.AppVerdict_APP_VERDICT_UNSPECIFIED
	}
}

func accountVerdictToProto(v string) integrityv1.AccountVerdict {
	switch v {
	case api.AccountLicensed:
		return integrityv1.AccountVerdict_ACCOUNT_VERDICT_LICENSED
	case api.AccountUnlicensed:
		return integrityv1.AccountVerdict_ACCOUNT_VERDICT_UNLICENSED
	case api.AccountUnevaluated:
		return integrityv1.AccountVerdict_ACCOUNT_VERDICT_UNEVALUATED
	default:
		return integrityv1.AccountVerdict_ACCOUNT_VERDICT_UNSPECIFIED
	}
}
