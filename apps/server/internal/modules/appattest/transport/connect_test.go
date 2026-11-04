package transport_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	appattestv1 "github.com/aedst/server/gen/go/aedst/appattest/v1"
	"github.com/aedst/server/internal/modules/appattest/api"
	"github.com/aedst/server/internal/modules/appattest/domain"
	"github.com/aedst/server/internal/modules/appattest/transport"
	platformauth "github.com/aedst/server/internal/platform/auth"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type fakeService struct {
	challenge api.Challenge
	enroll    api.EnrollResult
	assertion api.AssertionResult
	err       error

	user     ids.ID
	enrollIn api.EnrollInput
	assertIn api.AssertionInput
}

func (f *fakeService) CreateChallenge(_ context.Context, user ids.ID) (api.Challenge, error) {
	f.user = user
	return f.challenge, f.err
}

func (f *fakeService) Enroll(_ context.Context, in api.EnrollInput) (api.EnrollResult, error) {
	f.enrollIn = in
	return f.enroll, f.err
}

func (f *fakeService) VerifyAssertion(_ context.Context, in api.AssertionInput) (api.AssertionResult, error) {
	f.assertIn = in
	return f.assertion, f.err
}

func authed(user ids.ID) context.Context {
	return platformauth.WithIdentity(context.Background(), platformauth.Identity{UserID: user})
}

func TestCreateChallenge_ReturnsTheChallengeForTheCaller(t *testing.T) {
	user := ids.New()
	exp := time.Date(2026, 10, 8, 12, 5, 0, 0, time.UTC)
	svc := &fakeService{challenge: api.Challenge{Value: []byte("0123456789abcdef0123456789abcdef"), ExpiresAt: exp}}
	resp, err := transport.NewHandler(svc).CreateChallenge(authed(user), &appattestv1.CreateChallengeRequest{})
	if err != nil {
		t.Fatal(err)
	}
	if string(resp.GetChallenge()) != "0123456789abcdef0123456789abcdef" || !resp.GetExpiresAt().AsTime().Equal(exp) || svc.user != user {
		t.Errorf("response = %+v, user %v", resp, svc.user)
	}
}

func TestEnroll_MapsResultAndPassesTheCaller(t *testing.T) {
	user := ids.New()
	svc := &fakeService{enroll: api.EnrollResult{Verified: true, Environment: domain.EnvironmentDevelopment}}
	resp, err := transport.NewHandler(svc).Enroll(authed(user), &appattestv1.EnrollRequest{
		KeyId: "k", AttestationObject: []byte("o"), Challenge: []byte("c"), BundleId: "com.example.app",
	})
	if err != nil {
		t.Fatal(err)
	}
	if !resp.GetVerified() || resp.GetEnvironment() != appattestv1.Environment_ENVIRONMENT_DEVELOPMENT || resp.GetReason() != appattestv1.FailureReason_FAILURE_REASON_UNSPECIFIED {
		t.Errorf("response = %+v", resp)
	}
	if in := svc.enrollIn; in.UserID != user || in.KeyID != "k" || string(in.AttestationObject) != "o" || string(in.Challenge) != "c" || in.BundleID != "com.example.app" {
		t.Errorf("input = %+v", in)
	}
}

func TestRejectionsAreSuccessfulResponsesWithAReason(t *testing.T) {
	for reason, want := range map[domain.Reason]appattestv1.FailureReason{
		domain.ReasonChallengeInvalid:      appattestv1.FailureReason_FAILURE_REASON_CHALLENGE_INVALID,
		domain.ReasonBundleNotAllowed:      appattestv1.FailureReason_FAILURE_REASON_BUNDLE_NOT_ALLOWED,
		domain.ReasonAttestationMalformed:  appattestv1.FailureReason_FAILURE_REASON_ATTESTATION_MALFORMED,
		domain.ReasonCertificateChain:      appattestv1.FailureReason_FAILURE_REASON_CERTIFICATE_CHAIN_INVALID,
		domain.ReasonNonceMismatch:         appattestv1.FailureReason_FAILURE_REASON_NONCE_MISMATCH,
		domain.ReasonKeyIDMismatch:         appattestv1.FailureReason_FAILURE_REASON_KEY_ID_MISMATCH,
		domain.ReasonAppIDMismatch:         appattestv1.FailureReason_FAILURE_REASON_APP_ID_MISMATCH,
		domain.ReasonCounterNotZero:        appattestv1.FailureReason_FAILURE_REASON_COUNTER_NOT_ZERO,
		domain.ReasonAAGUIDInvalid:         appattestv1.FailureReason_FAILURE_REASON_AAGUID_INVALID,
		domain.ReasonEnvironmentNotAllowed: appattestv1.FailureReason_FAILURE_REASON_ENVIRONMENT_NOT_ALLOWED,
		domain.ReasonKeyAlreadyEnrolled:    appattestv1.FailureReason_FAILURE_REASON_KEY_ALREADY_ENROLLED,
		domain.ReasonKeyUnknown:            appattestv1.FailureReason_FAILURE_REASON_KEY_UNKNOWN,
		domain.ReasonAssertionMalformed:    appattestv1.FailureReason_FAILURE_REASON_ASSERTION_MALFORMED,
		domain.ReasonSignatureInvalid:      appattestv1.FailureReason_FAILURE_REASON_SIGNATURE_INVALID,
		domain.ReasonCounterNotIncreasing:  appattestv1.FailureReason_FAILURE_REASON_COUNTER_NOT_INCREASING,
	} {
		svc := &fakeService{enroll: api.EnrollResult{Reason: reason}, assertion: api.AssertionResult{Reason: reason}}
		h := transport.NewHandler(svc)
		e, err := h.Enroll(authed(ids.New()), &appattestv1.EnrollRequest{})
		if err != nil || e.GetVerified() || e.GetReason() != want || e.GetEnvironment() != appattestv1.Environment_ENVIRONMENT_UNSPECIFIED {
			t.Errorf("Enroll %q = %+v, %v", reason, e, err)
		}
		a, err := h.VerifyAssertion(authed(ids.New()), &appattestv1.VerifyAssertionRequest{Action: "login"})
		if err != nil || a.GetVerified() || a.GetReason() != want || a.GetAction() != "" {
			t.Errorf("VerifyAssertion %q = %+v, %v", reason, a, err)
		}
	}
}

func TestVerifyAssertion_EchoesTheActionWhenVerified(t *testing.T) {
	user := ids.New()
	svc := &fakeService{assertion: api.AssertionResult{Verified: true}}
	resp, err := transport.NewHandler(svc).VerifyAssertion(authed(user), &appattestv1.VerifyAssertionRequest{
		KeyId: "k", Assertion: []byte("a"), Action: "login", Payload: []byte("p"),
	})
	if err != nil || !resp.GetVerified() || resp.GetAction() != "login" {
		t.Fatalf("= %+v, %v", resp, err)
	}
	if in := svc.assertIn; in.UserID != user || in.KeyID != "k" || string(in.Assertion) != "a" || in.Action != "login" || string(in.Payload) != "p" {
		t.Errorf("input = %+v", in)
	}
}

func TestErrorsAndAuth(t *testing.T) {
	h := func(err error) *transport.Handler { return transport.NewHandler(&fakeService{err: err}) }
	if _, err := h(nil).CreateChallenge(context.Background(), &appattestv1.CreateChallengeRequest{}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("CreateChallenge without identity = %v", err)
	}
	if _, err := h(nil).Enroll(context.Background(), &appattestv1.EnrollRequest{}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("Enroll without identity = %v", err)
	}
	if _, err := h(nil).VerifyAssertion(context.Background(), &appattestv1.VerifyAssertionRequest{}); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("VerifyAssertion without identity = %v", err)
	}
	cases := map[connect.Code]error{
		connect.CodeFailedPrecondition: sharederrors.FailedPrecondition("appattest", "not configured"),
		connect.CodeResourceExhausted:  sharederrors.RateLimited("appattest", "slow down"),
		connect.CodeInvalidArgument:    sharederrors.Validation("appattest", "bad"),
		connect.CodeInternal:           errors.New("db down"),
	}
	for want, in := range cases {
		if _, err := h(in).CreateChallenge(authed(ids.New()), &appattestv1.CreateChallengeRequest{}); connect.CodeOf(err) != want {
			t.Errorf("CreateChallenge %v = %v, want %v", in, connect.CodeOf(err), want)
		}
		if _, err := h(in).Enroll(authed(ids.New()), &appattestv1.EnrollRequest{}); connect.CodeOf(err) != want {
			t.Errorf("Enroll %v = %v, want %v", in, connect.CodeOf(err), want)
		}
		if _, err := h(in).VerifyAssertion(authed(ids.New()), &appattestv1.VerifyAssertionRequest{}); connect.CodeOf(err) != want {
			t.Errorf("VerifyAssertion %v = %v, want %v", in, connect.CodeOf(err), want)
		}
	}
}
