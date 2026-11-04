// Package transport implements AppAttestService over appattest/api.
package transport

import (
	"context"

	"google.golang.org/protobuf/types/known/timestamppb"

	appattestv1 "github.com/aedst/server/gen/go/aedst/appattest/v1"
	"github.com/aedst/server/internal/modules/appattest/api"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type Handler struct {
	service api.Service
}

func NewHandler(service api.Service) *Handler { return &Handler{service: service} }

func caller(ctx context.Context) (ids.ID, error) {
	identity, ok := platformauth.FromContext(ctx)
	if !ok {
		return ids.Nil, httpserver.ToConnectError(sharederrors.Unauthorized("appattest", "missing identity"))
	}
	return identity.UserID, nil
}

func (h *Handler) CreateChallenge(ctx context.Context, _ *appattestv1.CreateChallengeRequest) (*appattestv1.CreateChallengeResponse, error) {
	user, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	ch, err := h.service.CreateChallenge(ctx, user)
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	return &appattestv1.CreateChallengeResponse{
		Challenge: ch.Value,
		ExpiresAt: timestamppb.New(ch.ExpiresAt),
	}, nil
}

func (h *Handler) Enroll(ctx context.Context, req *appattestv1.EnrollRequest) (*appattestv1.EnrollResponse, error) {
	user, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	msg := req
	res, err := h.service.Enroll(ctx, api.EnrollInput{
		UserID:            user,
		KeyID:             msg.GetKeyId(),
		AttestationObject: msg.GetAttestationObject(),
		Challenge:         msg.GetChallenge(),
		BundleID:          msg.GetBundleId(),
	})
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	out := &appattestv1.EnrollResponse{Verified: res.Verified, Reason: reasonToProto(res.Reason)}
	if res.Verified {
		out.Environment = environmentToProto(res.Environment)
	}
	return out, nil
}

func (h *Handler) VerifyAssertion(ctx context.Context, req *appattestv1.VerifyAssertionRequest) (*appattestv1.VerifyAssertionResponse, error) {
	user, err := caller(ctx)
	if err != nil {
		return nil, err
	}
	msg := req
	res, err := h.service.VerifyAssertion(ctx, api.AssertionInput{
		UserID:    user,
		KeyID:     msg.GetKeyId(),
		Assertion: msg.GetAssertion(),
		Action:    msg.GetAction(),
		Payload:   msg.GetPayload(),
	})
	if err != nil {
		return nil, httpserver.ToConnectError(err)
	}
	out := &appattestv1.VerifyAssertionResponse{Verified: res.Verified, Reason: reasonToProto(res.Reason)}
	if res.Verified {
		out.Action = msg.GetAction()
	}
	return out, nil
}

func environmentToProto(e api.Environment) appattestv1.Environment {
	switch e {
	case api.EnvironmentProduction:
		return appattestv1.Environment_ENVIRONMENT_PRODUCTION
	case api.EnvironmentDevelopment:
		return appattestv1.Environment_ENVIRONMENT_DEVELOPMENT
	default:
		return appattestv1.Environment_ENVIRONMENT_UNSPECIFIED
	}
}

var reasons = map[api.Reason]appattestv1.FailureReason{
	api.ReasonChallengeInvalid:      appattestv1.FailureReason_FAILURE_REASON_CHALLENGE_INVALID,
	api.ReasonBundleNotAllowed:      appattestv1.FailureReason_FAILURE_REASON_BUNDLE_NOT_ALLOWED,
	api.ReasonAttestationMalformed:  appattestv1.FailureReason_FAILURE_REASON_ATTESTATION_MALFORMED,
	api.ReasonCertificateChain:      appattestv1.FailureReason_FAILURE_REASON_CERTIFICATE_CHAIN_INVALID,
	api.ReasonNonceMismatch:         appattestv1.FailureReason_FAILURE_REASON_NONCE_MISMATCH,
	api.ReasonKeyIDMismatch:         appattestv1.FailureReason_FAILURE_REASON_KEY_ID_MISMATCH,
	api.ReasonAppIDMismatch:         appattestv1.FailureReason_FAILURE_REASON_APP_ID_MISMATCH,
	api.ReasonCounterNotZero:        appattestv1.FailureReason_FAILURE_REASON_COUNTER_NOT_ZERO,
	api.ReasonAAGUIDInvalid:         appattestv1.FailureReason_FAILURE_REASON_AAGUID_INVALID,
	api.ReasonEnvironmentNotAllowed: appattestv1.FailureReason_FAILURE_REASON_ENVIRONMENT_NOT_ALLOWED,
	api.ReasonKeyAlreadyEnrolled:    appattestv1.FailureReason_FAILURE_REASON_KEY_ALREADY_ENROLLED,
	api.ReasonKeyUnknown:            appattestv1.FailureReason_FAILURE_REASON_KEY_UNKNOWN,
	api.ReasonAssertionMalformed:    appattestv1.FailureReason_FAILURE_REASON_ASSERTION_MALFORMED,
	api.ReasonSignatureInvalid:      appattestv1.FailureReason_FAILURE_REASON_SIGNATURE_INVALID,
	api.ReasonCounterNotIncreasing:  appattestv1.FailureReason_FAILURE_REASON_COUNTER_NOT_INCREASING,
}

func reasonToProto(r api.Reason) appattestv1.FailureReason { return reasons[r] }
