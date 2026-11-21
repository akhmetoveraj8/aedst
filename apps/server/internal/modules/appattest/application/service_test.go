package application_test

import (
	"bytes"
	"context"
	"crypto/ecdsa"
	"crypto/elliptic"
	"crypto/rand"
	"encoding/base64"
	"errors"
	"sync"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/appattest/application"
	"github.com/aedst/server/internal/modules/appattest/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

var t0 = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

type clock struct{ now time.Time }

func (c *clock) Now() time.Time { return c.now }

var _ sharedtime.Clock = (*clock)(nil)

type challengeRow struct {
	user    ids.ID
	expires time.Time
	used    bool
}

type memChallenges struct {
	mu   sync.Mutex
	rows map[string]*challengeRow
}

func (m *memChallenges) Create(_ context.Context, user ids.ID, ch []byte, expires time.Time) error {
	m.mu.Lock()
	defer m.mu.Unlock()
	m.rows[string(ch)] = &challengeRow{user: user, expires: expires}
	return nil
}

func (m *memChallenges) Consume(_ context.Context, user ids.ID, ch []byte, now time.Time) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	r, ok := m.rows[string(ch)]
	if !ok || r.user != user || r.used || !now.Before(r.expires) {
		return false, nil
	}
	r.used = true
	return true, nil
}

type memKeys struct {
	mu   sync.Mutex
	keys map[string]*domain.Key
	err  error
}

func (m *memKeys) Create(_ context.Context, k domain.Key) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	if m.err != nil {
		return false, m.err
	}
	if _, ok := m.keys[string(k.ID)]; ok {
		return false, nil
	}
	k.Counter = 0
	m.keys[string(k.ID)] = &k
	return true, nil
}

func (m *memKeys) Get(_ context.Context, id []byte, user ids.ID) (domain.Key, bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k, ok := m.keys[string(id)]
	if !ok || k.UserID != user {
		return domain.Key{}, false, nil
	}
	return *k, true, nil
}

func (m *memKeys) AdvanceCounter(_ context.Context, id []byte, user ids.ID, c uint32, _ time.Time) (bool, error) {
	m.mu.Lock()
	defer m.mu.Unlock()
	k, ok := m.keys[string(id)]
	if !ok || k.UserID != user || k.Counter >= c {
		return false, nil
	}
	k.Counter = c
	return true, nil
}

type fakeAttester struct {
	res    domain.Attested
	reason domain.Reason
	in     domain.AttestationInput
	calls  int
}

func (f *fakeAttester) VerifyAttestation(in domain.AttestationInput) (domain.Attested, domain.Reason) {
	f.calls++
	f.in = in
	return f.res, f.reason
}

type fakeAsserter struct {
	mu      sync.Mutex
	counter uint32
	reason  domain.Reason
	in      domain.AssertionInput
}

func (f *fakeAsserter) VerifyAssertion(in domain.AssertionInput) (uint32, domain.Reason) {
	f.mu.Lock()
	defer f.mu.Unlock()
	f.in = in
	return f.counter, f.reason
}

type harness struct {
	svc        *application.Service
	attester   *fakeAttester
	asserter   *fakeAsserter
	challenges *memChallenges
	keys       *memKeys
	clock      *clock
	user       ids.ID
	keyID      []byte
	keyIDText  string
}

func newHarness(t *testing.T, policy domain.Policy, opts ...application.Option) *harness {
	t.Helper()
	priv, err := ecdsa.GenerateKey(elliptic.P256(), rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	keyID, _ := domain.KeyIDOf(&priv.PublicKey)
	h := &harness{
		attester:   &fakeAttester{res: domain.Attested{PublicKey: &priv.PublicKey, Environment: domain.EnvironmentProduction}},
		asserter:   &fakeAsserter{},
		challenges: &memChallenges{rows: map[string]*challengeRow{}},
		keys:       &memKeys{keys: map[string]*domain.Key{}},
		clock:      &clock{now: t0},
		user:       ids.New(),
		keyID:      keyID,
		keyIDText:  base64.StdEncoding.EncodeToString(keyID),
	}
	h.svc = application.NewService(h.attester, h.asserter, h.challenges, h.keys, policy, h.clock, opts...)
	return h
}

var testPolicy = domain.Policy{TeamID: "ABCDE12345", AllowedBundleIDs: []string{"com.example.app"}}

func (h *harness) challenge(t *testing.T, user ids.ID) []byte {
	t.Helper()
	ch, err := h.svc.CreateChallenge(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	return ch.Value
}

func (h *harness) enroll(t *testing.T, ch []byte) application.EnrollResult {
	t.Helper()
	res, err := h.svc.Enroll(context.Background(), application.EnrollInput{
		UserID: h.user, KeyID: h.keyIDText, AttestationObject: []byte("obj"), Challenge: ch,
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestDisabledServiceIsFailedPrecondition(t *testing.T) {
	svc := application.NewService(nil, nil, nil, nil, domain.Policy{}, &clock{now: t0})
	ctx := context.Background()
	if _, err := svc.CreateChallenge(ctx, ids.New()); sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition {
		t.Errorf("CreateChallenge = %v", err)
	}
	if _, err := svc.Enroll(ctx, application.EnrollInput{}); sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition {
		t.Errorf("Enroll = %v", err)
	}
	if _, err := svc.VerifyAssertion(ctx, application.AssertionInput{}); sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition {
		t.Errorf("VerifyAssertion = %v", err)
	}
}

func TestCreateChallenge_Random32BytesWithFiveMinuteTTL(t *testing.T) {
	h := newHarness(t, testPolicy)
	a, err := h.svc.CreateChallenge(context.Background(), h.user)
	if err != nil {
		t.Fatal(err)
	}
	b, _ := h.svc.CreateChallenge(context.Background(), h.user)
	if len(a.Value) != 32 || bytes.Equal(a.Value, b.Value) {
		t.Errorf("challenges %x %x", a.Value, b.Value)
	}
	if !a.ExpiresAt.Equal(t0.Add(5 * time.Minute)) {
		t.Errorf("expires = %v", a.ExpiresAt)
	}
	if len(h.challenges.rows) != 2 {
		t.Errorf("%d stored", len(h.challenges.rows))
	}
}

func TestEnroll_HappyPathBindsTheKeyToTheUserAndHashesTheChallenge(t *testing.T) {
	h := newHarness(t, testPolicy)
	ch := h.challenge(t, h.user)
	res := h.enroll(t, ch)
	if !res.Verified || res.Environment != domain.EnvironmentProduction {
		t.Fatalf("= %+v", res)
	}
	k, ok, _ := h.keys.Get(context.Background(), h.keyID, h.user)
	if !ok || k.BundleID != "com.example.app" || k.Counter != 0 {
		t.Fatalf("stored key = %+v %v", k, ok)
	}
	if h.attester.in.AppID != "ABCDE12345.com.example.app" || len(h.attester.in.ClientDataHash) != 32 || bytes.Equal(h.attester.in.ClientDataHash, ch) {
		t.Errorf("attester input = %+v", h.attester.in)
	}
}

func TestEnroll_ChallengeRules(t *testing.T) {
	t.Run("replayed challenge", func(t *testing.T) {
		h := newHarness(t, testPolicy)
		ch := h.challenge(t, h.user)
		if !h.enroll(t, ch).Verified {
			t.Fatal("first enroll failed")
		}
		h.keys.keys = map[string]*domain.Key{} // even if the key were gone, the challenge is spent
		if res := h.enroll(t, ch); res.Verified || res.Reason != domain.ReasonChallengeInvalid {
			t.Fatalf("replay = %+v", res)
		}
	})
	t.Run("expired challenge", func(t *testing.T) {
		h := newHarness(t, testPolicy)
		ch := h.challenge(t, h.user)
		h.clock.now = t0.Add(5 * time.Minute)
		if res := h.enroll(t, ch); res.Reason != domain.ReasonChallengeInvalid || h.attester.calls != 0 {
			t.Fatalf("= %+v, attester calls %d", res, h.attester.calls)
		}
	})
	t.Run("challenge of another user", func(t *testing.T) {
		h := newHarness(t, testPolicy)
		ch := h.challenge(t, ids.New())
		if res := h.enroll(t, ch); res.Reason != domain.ReasonChallengeInvalid {
			t.Fatalf("= %+v", res)
		}
	})
	t.Run("unknown challenge", func(t *testing.T) {
		h := newHarness(t, testPolicy)
		if res := h.enroll(t, bytes.Repeat([]byte{1}, 32)); res.Reason != domain.ReasonChallengeInvalid {
			t.Fatalf("= %+v", res)
		}
	})
	t.Run("a rejected attestation still burns the challenge", func(t *testing.T) {
		h := newHarness(t, testPolicy)
		ch := h.challenge(t, h.user)
		h.attester.reason = domain.ReasonNonceMismatch
		if res := h.enroll(t, ch); res.Reason != domain.ReasonNonceMismatch {
			t.Fatalf("= %+v", res)
		}
		h.attester.reason = domain.ReasonNone
		if res := h.enroll(t, ch); res.Reason != domain.ReasonChallengeInvalid {
			t.Fatalf("second try = %+v", res)
		}
	})
}

func TestEnroll_PolicyAndStore(t *testing.T) {
	t.Run("bundle not in the allow-list", func(t *testing.T) {
		h := newHarness(t, testPolicy)
		res, err := h.svc.Enroll(context.Background(), application.EnrollInput{
			UserID: h.user, KeyID: h.keyIDText, AttestationObject: []byte("o"), Challenge: h.challenge(t, h.user), BundleID: "com.evil.app",
		})
		if err != nil || res.Reason != domain.ReasonBundleNotAllowed || h.attester.calls != 0 {
			t.Fatalf("= %+v %v", res, err)
		}
	})
	t.Run("empty bundle with several allowed", func(t *testing.T) {
		p := testPolicy
		p.AllowedBundleIDs = []string{"com.example.app", "com.example.app.beta"}
		h := newHarness(t, p)
		if res := h.enroll(t, h.challenge(t, h.user)); res.Reason != domain.ReasonBundleNotAllowed {
			t.Fatalf("= %+v", res)
		}
	})
	t.Run("development rejected unless allowed", func(t *testing.T) {
		h := newHarness(t, testPolicy)
		h.attester.res.Environment = domain.EnvironmentDevelopment
		if res := h.enroll(t, h.challenge(t, h.user)); res.Reason != domain.ReasonEnvironmentNotAllowed {
			t.Fatalf("= %+v", res)
		}
		p := testPolicy
		p.AllowDevelopment = true
		h = newHarness(t, p)
		h.attester.res.Environment = domain.EnvironmentDevelopment
		if res := h.enroll(t, h.challenge(t, h.user)); !res.Verified || res.Environment != domain.EnvironmentDevelopment {
			t.Fatalf("= %+v", res)
		}
	})
	t.Run("key already enrolled", func(t *testing.T) {
		h := newHarness(t, testPolicy)
		h.enroll(t, h.challenge(t, h.user))
		if res := h.enroll(t, h.challenge(t, h.user)); res.Reason != domain.ReasonKeyAlreadyEnrolled {
			t.Fatalf("= %+v", res)
		}
	})
	t.Run("store failure is an error, not a verdict", func(t *testing.T) {
		h := newHarness(t, testPolicy)
		h.keys.err = errors.New("db down")
		_, err := h.svc.Enroll(context.Background(), application.EnrollInput{UserID: h.user, KeyID: h.keyIDText, AttestationObject: []byte("o"), Challenge: h.challenge(t, h.user)})
		if err == nil {
			t.Fatal("want an error")
		}
	})
	t.Run("malformed input is a validation error", func(t *testing.T) {
		h := newHarness(t, testPolicy)
		for name, in := range map[string]application.EnrollInput{
			"bad key id":      {KeyID: "nope", AttestationObject: []byte("o"), Challenge: bytes.Repeat([]byte{1}, 32)},
			"short challenge": {KeyID: h.keyIDText, AttestationObject: []byte("o"), Challenge: []byte{1}},
			"no object":       {KeyID: h.keyIDText, Challenge: bytes.Repeat([]byte{1}, 32)},
		} {
			if _, err := h.svc.Enroll(context.Background(), in); sharederrors.KindOf(err) != sharederrors.KindValidation {
				t.Errorf("%s: %v", name, err)
			}
		}
	})
}

func (h *harness) assertion(t *testing.T, user ids.ID, counter uint32, reason domain.Reason) application.AssertionResult {
	t.Helper()
	h.asserter.counter, h.asserter.reason = counter, reason
	res, err := h.svc.VerifyAssertion(context.Background(), application.AssertionInput{
		UserID: user, KeyID: h.keyIDText, Assertion: []byte("a"), Action: "login", Payload: []byte("p"),
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestVerifyAssertion_CounterAndOwnership(t *testing.T) {
	h := newHarness(t, testPolicy)
	if !h.enroll(t, h.challenge(t, h.user)).Verified {
		t.Fatal("enroll")
	}

	if res := h.assertion(t, h.user, 1, domain.ReasonNone); !res.Verified {
		t.Fatalf("first assertion = %+v", res)
	}
	if got := h.asserter.in; got.AppID != "ABCDE12345.com.example.app" || got.ClientDataHash != domain.ClientDataHash("login", []byte("p")) {
		t.Errorf("asserter input = %+v", got)
	}
	if res := h.assertion(t, h.user, 1, domain.ReasonNone); res.Reason != domain.ReasonCounterNotIncreasing {
		t.Errorf("replayed counter = %+v", res)
	}
	if res := h.assertion(t, h.user, 5, domain.ReasonNone); !res.Verified {
		t.Errorf("counter jump = %+v", res)
	}
	if res := h.assertion(t, h.user, 3, domain.ReasonNone); res.Reason != domain.ReasonCounterNotIncreasing {
		t.Errorf("decreasing counter = %+v", res)
	}
	if res := h.assertion(t, ids.New(), 6, domain.ReasonNone); res.Reason != domain.ReasonKeyUnknown {
		t.Errorf("another user's key = %+v", res)
	}
	// A failed verification must not move the counter.
	if res := h.assertion(t, h.user, 9, domain.ReasonSignatureInvalid); res.Reason != domain.ReasonSignatureInvalid {
		t.Errorf("bad signature = %+v", res)
	}
	if res := h.assertion(t, h.user, 6, domain.ReasonNone); !res.Verified {
		t.Errorf("counter 6 after a rejected 9 = %+v", res)
	}
}

func TestVerifyAssertion_EnvironmentPolicyAppliesToEnrolledKeys(t *testing.T) {
	dev := domain.Policy{TeamID: "ABCDE12345", AllowedBundleIDs: []string{"com.example.app"}, AllowDevelopment: true}
	h := newHarness(t, dev)
	h.attester.res.Environment = domain.EnvironmentDevelopment
	if res := h.enroll(t, h.challenge(t, h.user)); !res.Verified {
		t.Fatalf("development enrollment = %+v", res)
	}
	if res := h.assertion(t, h.user, 1, domain.ReasonNone); !res.Verified {
		t.Fatalf("development assertion while allowed = %+v", res)
	}
	// AllowDevelopment is switched off: the already enrolled development key stops working.
	h.svc = application.NewService(h.attester, h.asserter, h.challenges, h.keys, testPolicy, h.clock)
	if res := h.assertion(t, h.user, 2, domain.ReasonNone); res.Verified || res.Reason != domain.ReasonEnvironmentNotAllowed {
		t.Errorf("development key after AllowDevelopment=false = %+v", res)
	}
	if h.keys.keys[string(h.keyID)].Counter != 1 {
		t.Error("a rejected assertion moved the counter")
	}
}

func TestVerifyAssertion_UnknownKeyBundleAndInput(t *testing.T) {
	h := newHarness(t, testPolicy)
	if res := h.assertion(t, h.user, 1, domain.ReasonNone); res.Reason != domain.ReasonKeyUnknown {
		t.Errorf("never enrolled = %+v", res)
	}
	h.enroll(t, h.challenge(t, h.user))
	// The bundle was removed from the allow-list after enrollment.
	h.svc = application.NewService(h.attester, h.asserter, h.challenges, h.keys, domain.Policy{TeamID: "ABCDE12345", AllowedBundleIDs: []string{"com.other"}}, h.clock)
	if res := h.assertion(t, h.user, 1, domain.ReasonNone); res.Reason != domain.ReasonBundleNotAllowed {
		t.Errorf("removed bundle = %+v", res)
	}
	for name, in := range map[string]application.AssertionInput{
		"bad action": {KeyID: h.keyIDText, Assertion: []byte("a"), Action: "Bad Action"},
		"bad key id": {KeyID: "x", Assertion: []byte("a"), Action: "login"},
		"no data":    {KeyID: h.keyIDText, Action: "login"},
	} {
		if _, err := h.svc.VerifyAssertion(context.Background(), in); sharederrors.KindOf(err) != sharederrors.KindValidation {
			t.Errorf("%s: %v", name, err)
		}
	}
}

func TestVerifyAssertion_ConcurrentSameCounterHasOneWinner(t *testing.T) {
	h := newHarness(t, testPolicy)
	h.enroll(t, h.challenge(t, h.user))
	h.asserter.counter = 7
	var wins int
	var mu sync.Mutex
	var wg sync.WaitGroup
	for range 16 {
		wg.Go(func() {
			res, err := h.svc.VerifyAssertion(context.Background(), application.AssertionInput{UserID: h.user, KeyID: h.keyIDText, Assertion: []byte("a"), Action: "login"})
			if err != nil {
				t.Error(err)
				return
			}
			if res.Verified {
				mu.Lock()
				wins++
				mu.Unlock()
			}
		})
	}
	wg.Wait()
	if wins != 1 {
		t.Fatalf("%d winners, want 1", wins)
	}
}
