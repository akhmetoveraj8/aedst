package transport_test

import (
	"context"
	"errors"
	"testing"
	"time"

	"connectrpc.com/connect/v2"

	integrityv1 "github.com/aedst/server/gen/go/aedst/integrity/v1"
	"github.com/aedst/server/internal/modules/integrity/api"
	"github.com/aedst/server/internal/modules/integrity/domain"
	"github.com/aedst/server/internal/modules/integrity/transport"
	platformauth "github.com/aedst/server/internal/platform/auth"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type fakeService struct {
	res api.Result
	err error
	in  api.VerifyInput
}

func (f *fakeService) Verify(_ context.Context, in api.VerifyInput) (api.Result, error) {
	f.in = in
	return f.res, f.err
}

func authed(user ids.ID) context.Context {
	return platformauth.WithIdentity(context.Background(), platformauth.Identity{UserID: user})
}

func TestVerifyIntegrityToken_MapsVerdictAndPassesTheCaller(t *testing.T) {
	user := ids.New()
	issued := time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)
	svc := &fakeService{res: api.Result{Verified: true, Decoded: true, Evidence: domain.Evidence{
		IssuedAt: issued, DeviceVerdicts: []string{domain.DeviceDevice, "SOMETHING_NEW"},
		AppVerdict: domain.AppPlayRecognized, AccountVerdict: domain.AccountLicensed,
	}}}
	resp, err := transport.NewHandler(svc).VerifyIntegrityToken(authed(user), &integrityv1.VerifyIntegrityTokenRequest{
		IntegrityToken: "tok", Action: "login", Payload: []byte("n"), RequestHash: "h", PackageName: "com.aedst.android",
	})
	if err != nil {
		t.Fatal(err)
	}
	m := resp
	if !m.GetVerified() || m.GetReason() != integrityv1.FailureReason_FAILURE_REASON_UNSPECIFIED || m.GetAction() != "login" ||
		m.GetAppVerdict() != integrityv1.AppVerdict_APP_VERDICT_PLAY_RECOGNIZED ||
		m.GetAccountVerdict() != integrityv1.AccountVerdict_ACCOUNT_VERDICT_LICENSED ||
		!m.GetTokenIssuedAt().AsTime().Equal(issued) {
		t.Errorf("response = %+v", m)
	}
	if got := m.GetDeviceVerdicts(); len(got) != 1 || got[0] != integrityv1.DeviceVerdict_DEVICE_VERDICT_MEETS_DEVICE_INTEGRITY {
		t.Errorf("device verdicts = %v (unknown strings must be dropped)", got)
	}
	if svc.in.UserID != user || svc.in.Token != "tok" || svc.in.PackageName != "com.aedst.android" {
		t.Errorf("service input = %+v", svc.in)
	}
}

func TestVerifyIntegrityToken_RejectionIsASuccessfulResponseWithAReason(t *testing.T) {
	svc := &fakeService{res: api.Result{Reason: domain.ReasonTokenReplayed, Decoded: true}}
	resp, err := transport.NewHandler(svc).VerifyIntegrityToken(authed(ids.New()), &integrityv1.VerifyIntegrityTokenRequest{})
	if err != nil || resp.GetVerified() || resp.GetReason() != integrityv1.FailureReason_FAILURE_REASON_TOKEN_REPLAYED || resp.GetAction() != "" {
		t.Fatalf("= %+v, %v", resp, err)
	}
}

func TestVerifyIntegrityToken_ErrorsAndAuth(t *testing.T) {
	h := func(err error) *transport.Handler { return transport.NewHandler(&fakeService{err: err}) }
	req := &integrityv1.VerifyIntegrityTokenRequest{}

	if _, err := h(nil).VerifyIntegrityToken(context.Background(), req); connect.CodeOf(err) != connect.CodeUnauthenticated {
		t.Errorf("no identity = %v, want Unauthenticated", err)
	}
	cases := map[connect.Code]error{
		connect.CodeFailedPrecondition: sharederrors.FailedPrecondition("integrity.Verify", "not configured"),
		connect.CodeResourceExhausted:  sharederrors.RateLimited("integrity.Verify", "slow down"),
		connect.CodeInternal:           errors.New("google down"),
	}
	for want, in := range cases {
		if _, err := h(in).VerifyIntegrityToken(authed(ids.New()), req); connect.CodeOf(err) != want {
			t.Errorf("%v = %v, want %v", in, connect.CodeOf(err), want)
		}
	}
}
