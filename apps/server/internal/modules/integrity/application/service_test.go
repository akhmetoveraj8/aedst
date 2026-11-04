package application_test

import (
	"context"
	"crypto/sha256"
	"errors"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/integrity/application"
	"github.com/aedst/server/internal/modules/integrity/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

var now = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

const pkg = "com.aedst.android"

type fakeDecoder struct {
	evidence domain.Evidence
	err      error
	calls    int
	gotPkg   string
}

func (f *fakeDecoder) Decode(_ context.Context, p, _ string) (domain.Evidence, error) {
	f.calls++
	f.gotPkg = p
	return f.evidence, f.err
}

type fakeStore struct {
	seen map[[32]byte]bool
	err  error
}

func (f *fakeStore) Claim(_ context.Context, h [32]byte, _ ids.ID, _ time.Time) (bool, error) {
	if f.err != nil {
		return false, f.err
	}
	if f.seen[h] {
		return false, nil
	}
	f.seen[h] = true
	return true, nil
}

type fakeLimiter struct {
	allow bool
	err   error
	key   string
}

func (f *fakeLimiter) Allow(_ context.Context, key string, _ int, _ time.Duration) (bool, error) {
	f.key = key
	return f.allow, f.err
}

func policy() domain.Policy {
	return domain.Policy{
		AllowedPackages: []string{pkg}, MaxAge: 5 * time.Minute, MaxFutureSkew: 30 * time.Second,
		MinDeviceLevel: domain.LevelDevice, RequirePlayRecognized: true,
	}
}

type fixture struct {
	dec   *fakeDecoder
	store *fakeStore
	svc   *application.Service
	in    application.VerifyInput
}

func newFixture(opts ...application.Option) fixture {
	in := application.VerifyInput{
		UserID: ids.New(), Token: "opaque-token-value", Action: "login", Payload: []byte("n-1"),
	}
	in.RequestHash = domain.RequestHash(in.Action, in.Payload)
	dec := &fakeDecoder{evidence: domain.Evidence{
		PackageName: pkg, RequestHash: in.RequestHash, IssuedAt: now.Add(-time.Second),
		DeviceVerdicts: []string{domain.DeviceDevice, domain.DeviceBasic}, AppVerdict: domain.AppPlayRecognized,
		AccountVerdict: domain.AccountLicensed,
	}}
	store := &fakeStore{seen: map[[32]byte]bool{}}
	return fixture{dec, store, application.NewService(dec, store, policy(), sharedtime.Fixed{At: now}, opts...), in}
}

func TestVerify_AcceptsOnceAndRejectsReplay(t *testing.T) {
	f := newFixture()
	res, err := f.svc.Verify(context.Background(), f.in)
	if err != nil || !res.Verified || res.Reason != domain.ReasonNone || !res.Decoded {
		t.Fatalf("first Verify = %+v, %v", res, err)
	}
	if f.dec.gotPkg != pkg {
		t.Errorf("decoded for package %q, want the single allowed one", f.dec.gotPkg)
	}
	if !f.store.seen[sha256.Sum256([]byte(f.in.Token))] {
		t.Error("token hash was not recorded")
	}
	res, err = f.svc.Verify(context.Background(), f.in)
	if err != nil || res.Verified || res.Reason != domain.ReasonTokenReplayed {
		t.Fatalf("second Verify = %+v, %v; want token_replayed", res, err)
	}
}

func TestVerify_RejectionsAreResultsNotErrors(t *testing.T) {
	t.Run("wrong request hash never reaches Google", func(t *testing.T) {
		f := newFixture()
		f.in.RequestHash = domain.RequestHash("login", []byte("other"))
		res, err := f.svc.Verify(context.Background(), f.in)
		if err != nil || res.Reason != domain.ReasonRequestHashMismatch || f.dec.calls != 0 {
			t.Fatalf("= %+v, %v, calls=%d", res, err, f.dec.calls)
		}
	})
	t.Run("package not allowed never reaches Google", func(t *testing.T) {
		f := newFixture()
		f.in.PackageName = "com.evil.app"
		res, err := f.svc.Verify(context.Background(), f.in)
		if err != nil || res.Reason != domain.ReasonPackageMismatch || f.dec.calls != 0 {
			t.Fatalf("= %+v, %v, calls=%d", res, err, f.dec.calls)
		}
	})
	t.Run("undecodable", func(t *testing.T) {
		f := newFixture()
		f.dec.err = application.ErrUndecodable
		res, err := f.svc.Verify(context.Background(), f.in)
		if err != nil || res.Reason != domain.ReasonTokenUndecodable || res.Verified {
			t.Fatalf("= %+v, %v", res, err)
		}
	})
	t.Run("policy failure does not consume the token", func(t *testing.T) {
		f := newFixture()
		f.dec.evidence.DeviceVerdicts = []string{domain.DeviceBasic}
		res, err := f.svc.Verify(context.Background(), f.in)
		if err != nil || res.Reason != domain.ReasonDeviceNotTrusted || !res.Decoded || len(f.store.seen) != 0 {
			t.Fatalf("= %+v, %v, seen=%d", res, err, len(f.store.seen))
		}
	})
	t.Run("token bound to another request", func(t *testing.T) {
		f := newFixture()
		f.dec.evidence.RequestHash = domain.RequestHash("login", []byte("someone-else"))
		res, err := f.svc.Verify(context.Background(), f.in)
		if err != nil || res.Reason != domain.ReasonTokenNotBound {
			t.Fatalf("= %+v, %v", res, err)
		}
	})
}

func TestVerify_OperationalFailuresAreErrors(t *testing.T) {
	f := newFixture()
	f.dec.err = errors.New("google: 503")
	if _, err := f.svc.Verify(context.Background(), f.in); err == nil || sharederrors.KindOf(err) != sharederrors.KindUnknown {
		t.Fatalf("decoder outage = %v, want an internal error", err)
	}
	f = newFixture()
	f.store.err = errors.New("db down")
	if _, err := f.svc.Verify(context.Background(), f.in); err == nil {
		t.Fatal("replay store outage must fail closed, not accept")
	}
}

func TestVerify_DisabledAndInvalidInput(t *testing.T) {
	disabled := application.NewService(nil, nil, domain.Policy{}, sharedtime.Fixed{At: now})
	if disabled.Enabled() {
		t.Fatal("service without a decoder must report disabled")
	}
	_, err := disabled.Verify(context.Background(), application.VerifyInput{Token: "t", Action: "login"})
	if sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition {
		t.Fatalf("disabled Verify = %v, want FailedPrecondition", err)
	}
	f := newFixture()
	f.in.Action = "Bad Action"
	if _, err := f.svc.Verify(context.Background(), f.in); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Fatalf("bad action = %v, want Validation", err)
	}
}

func TestVerify_RateLimitIsPerUserAndFailsOpen(t *testing.T) {
	lim := &fakeLimiter{allow: false}
	f := newFixture(application.WithLimiter(lim, 10))
	if _, err := f.svc.Verify(context.Background(), f.in); sharederrors.KindOf(err) != sharederrors.KindRateLimited {
		t.Fatalf("over budget = %v, want RateLimited", err)
	}
	if lim.key != "integrity:verify:"+f.in.UserID.String() || f.dec.calls != 0 {
		t.Errorf("key=%q calls=%d", lim.key, f.dec.calls)
	}
	lim.err = errors.New("valkey down")
	if res, err := f.svc.Verify(context.Background(), f.in); err != nil || !res.Verified {
		t.Fatalf("limiter outage must fail open: %+v, %v", res, err)
	}
}
