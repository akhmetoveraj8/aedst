//go:build integration

package postgres_test

import (
	"bytes"
	"context"
	"sync"
	"sync/atomic"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/appattest/appattesttest"
	"github.com/aedst/server/internal/modules/appattest/application"
	"github.com/aedst/server/internal/modules/appattest/domain"
	"github.com/aedst/server/internal/modules/appattest/infrastructure/apple"
	"github.com/aedst/server/internal/modules/appattest/infrastructure/postgres"
	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

const (
	teamID   = "ABCDE12345"
	bundleID = "com.example.aedst"
	appID    = teamID + "." + bundleID
)

type stack struct {
	svc        *application.Service
	challenges *postgres.ChallengeRepository
	keys       *postgres.KeyRepository
	pki        *appattesttest.PKI
	clock      *testClock
}

type testClock struct {
	mu  sync.Mutex
	now time.Time
}

func (c *testClock) Now() time.Time {
	c.mu.Lock()
	defer c.mu.Unlock()
	return c.now
}

func (c *testClock) advance(d time.Duration) {
	c.mu.Lock()
	defer c.mu.Unlock()
	c.now = c.now.Add(d)
}

var _ sharedtime.Clock = (*testClock)(nil)

func newStack(t *testing.T, allowDev bool) *stack {
	t.Helper()
	pool := postgrestest.NewPool(t, "appattest")
	pki := appattesttest.NewPKI(t)
	clock := &testClock{now: appattesttest.Now}
	verifier := apple.NewVerifier(pki.Roots, clock)
	challenges, keys := postgres.NewChallengeRepository(pool), postgres.NewKeyRepository(pool)
	policy := domain.Policy{TeamID: teamID, AllowedBundleIDs: []string{bundleID}, AllowDevelopment: allowDev}
	return &stack{
		svc:        application.NewService(verifier, verifier, challenges, keys, policy, clock),
		challenges: challenges, keys: keys, pki: pki, clock: clock,
	}
}

func (s *stack) enroll(t *testing.T, user ids.ID, dev *appattesttest.Device, opts appattesttest.AttestOpts) application.EnrollResult {
	t.Helper()
	ch, err := s.svc.CreateChallenge(context.Background(), user)
	if err != nil {
		t.Fatal(err)
	}
	opts.AppID, opts.Challenge = appID, ch.Value
	res, err := s.svc.Enroll(context.Background(), application.EnrollInput{
		UserID: user, KeyID: dev.KeyIDString, AttestationObject: dev.Attest(t, opts), Challenge: ch.Value,
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func (s *stack) assert(t *testing.T, user ids.ID, dev *appattesttest.Device, counter uint32) application.AssertionResult {
	t.Helper()
	res, err := s.svc.VerifyAssertion(context.Background(), application.AssertionInput{
		UserID: user, KeyID: dev.KeyIDString, Assertion: dev.Assert(t, appID, counter, "login", []byte("n")), Action: "login", Payload: []byte("n"),
	})
	if err != nil {
		t.Fatal(err)
	}
	return res
}

func TestEndToEnd_EnrollThenAssertionsWithReplayProtection(t *testing.T) {
	s := newStack(t, false)
	user := ids.New()
	dev := s.pki.NewDevice(t)

	if res := s.enroll(t, user, dev, appattesttest.AttestOpts{}); !res.Verified || res.Environment != domain.EnvironmentProduction {
		t.Fatalf("enroll = %+v", res)
	}
	if res := s.assert(t, user, dev, 1); !res.Verified {
		t.Fatalf("assertion 1 = %+v", res)
	}
	if res := s.assert(t, user, dev, 1); res.Reason != domain.ReasonCounterNotIncreasing {
		t.Errorf("replayed assertion = %+v", res)
	}
	if res := s.assert(t, user, dev, 4); !res.Verified {
		t.Errorf("assertion 4 = %+v", res)
	}
	if res := s.assert(t, user, dev, 2); res.Reason != domain.ReasonCounterNotIncreasing {
		t.Errorf("decreasing counter = %+v", res)
	}
	if res := s.assert(t, ids.New(), dev, 9); res.Reason != domain.ReasonKeyUnknown {
		t.Errorf("another user = %+v", res)
	}
	if k, ok, err := s.keys.Get(context.Background(), dev.KeyID, user); err != nil || !ok || k.Counter != 4 || k.BundleID != bundleID || !k.PublicKey.Equal(&dev.Key.PublicKey) {
		t.Errorf("stored key = %+v %v %v", k, ok, err)
	}

	// The same key cannot be enrolled twice, by anyone.
	if res := s.enroll(t, user, dev, appattesttest.AttestOpts{}); res.Reason != domain.ReasonKeyAlreadyEnrolled {
		t.Errorf("re-enroll = %+v", res)
	}
	if res := s.enroll(t, ids.New(), dev, appattesttest.AttestOpts{}); res.Reason != domain.ReasonKeyAlreadyEnrolled {
		t.Errorf("enroll by another user = %+v", res)
	}
}

func TestEndToEnd_EnrollRejections(t *testing.T) {
	s := newStack(t, false)
	user := ids.New()
	if res := s.enroll(t, user, s.pki.NewDevice(t), appattesttest.AttestOpts{AAGUID: appattesttest.AAGUIDDevelopment}); res.Reason != domain.ReasonEnvironmentNotAllowed {
		t.Errorf("development while disallowed = %+v", res)
	}
	if res := s.enroll(t, user, s.pki.NewDevice(t), appattesttest.AttestOpts{Counter: 3}); res.Reason != domain.ReasonCounterNotZero {
		t.Errorf("counter = %+v", res)
	}
	if res := s.enroll(t, user, s.pki.NewDevice(t), appattesttest.AttestOpts{SignWith: appattesttest.NewPKI(t)}); res.Reason != domain.ReasonCertificateChain {
		t.Errorf("foreign chain = %+v", res)
	}

	dev := s.pki.NewDevice(t)
	dev2 := s.pki.NewDevice(t)
	ch, _ := s.svc.CreateChallenge(context.Background(), user)
	obj := dev.Attest(t, appattesttest.AttestOpts{AppID: appID, Challenge: ch.Value})
	// Wrong key id for this attestation object.
	res, err := s.svc.Enroll(context.Background(), application.EnrollInput{UserID: user, KeyID: dev2.KeyIDString, AttestationObject: obj, Challenge: ch.Value})
	if err != nil || res.Reason != domain.ReasonKeyIDMismatch {
		t.Errorf("key id mismatch = %+v %v", res, err)
	}
	// The challenge was burned by that attempt.
	res, _ = s.svc.Enroll(context.Background(), application.EnrollInput{UserID: user, KeyID: dev.KeyIDString, AttestationObject: obj, Challenge: ch.Value})
	if res.Reason != domain.ReasonChallengeInvalid {
		t.Errorf("reused challenge = %+v", res)
	}
}

func TestEndToEnd_DevelopmentKeysWhenAllowed(t *testing.T) {
	s := newStack(t, true)
	if res := s.enroll(t, ids.New(), s.pki.NewDevice(t), appattesttest.AttestOpts{AAGUID: appattesttest.AAGUIDDevelopment}); !res.Verified || res.Environment != domain.EnvironmentDevelopment {
		t.Fatalf("= %+v", res)
	}
}

func TestChallenge_SingleUseExpiryAndOwnershipInPostgres(t *testing.T) {
	s := newStack(t, false)
	ctx := context.Background()
	user, other := ids.New(), ids.New()
	now := s.clock.Now()
	ch := bytes.Repeat([]byte{5}, 32)
	if err := s.challenges.Create(ctx, user, ch, now.Add(domain.ChallengeTTL)); err != nil {
		t.Fatal(err)
	}
	if ok, err := s.challenges.Consume(ctx, other, ch, now); err != nil || ok {
		t.Fatalf("another user consumed it: %v %v", ok, err)
	}

	var wins atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := s.challenges.Consume(ctx, user, ch, now)
			if err != nil {
				t.Errorf("Consume: %v", err)
			}
			if ok {
				wins.Add(1)
			}
		}()
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("%d concurrent consumers won, want exactly 1", wins.Load())
	}

	expired := bytes.Repeat([]byte{6}, 32)
	if err := s.challenges.Create(ctx, user, expired, now.Add(domain.ChallengeTTL)); err != nil {
		t.Fatal(err)
	}
	if ok, _ := s.challenges.Consume(ctx, user, expired, now.Add(domain.ChallengeTTL)); ok {
		t.Error("a challenge is unusable from its expiry instant on")
	}
}

func TestAdvanceCounter_ConcurrentSameValueHasOneWinner(t *testing.T) {
	s := newStack(t, false)
	user := ids.New()
	dev := s.pki.NewDevice(t)
	if res := s.enroll(t, user, dev, appattesttest.AttestOpts{}); !res.Verified {
		t.Fatalf("enroll = %+v", res)
	}
	ctx := context.Background()
	var wins atomic.Int32
	var wg sync.WaitGroup
	for range 8 {
		wg.Add(1)
		go func() {
			defer wg.Done()
			ok, err := s.keys.AdvanceCounter(ctx, dev.KeyID, user, 10, s.clock.Now())
			if err != nil {
				t.Errorf("AdvanceCounter: %v", err)
			}
			if ok {
				wins.Add(1)
			}
		}()
	}
	wg.Wait()
	if wins.Load() != 1 {
		t.Fatalf("%d winners, want exactly 1", wins.Load())
	}
	if ok, _ := s.keys.AdvanceCounter(ctx, dev.KeyID, user, 9, s.clock.Now()); ok {
		t.Error("the counter went backwards")
	}
	if ok, _ := s.keys.AdvanceCounter(ctx, dev.KeyID, ids.New(), 11, s.clock.Now()); ok {
		t.Error("another user advanced the counter")
	}
	// uint32 max fits the BIGINT column and the CHECK.
	if ok, err := s.keys.AdvanceCounter(ctx, dev.KeyID, user, 4294967295, s.clock.Now()); err != nil || !ok {
		t.Errorf("max counter = %v %v", ok, err)
	}
}

func TestPurge_RemovesOnlyOldChallengesAndIdleKeys(t *testing.T) {
	s := newStack(t, false)
	ctx := context.Background()
	user := ids.New()
	now := s.clock.Now()

	oldCh, freshCh := bytes.Repeat([]byte{1}, 32), bytes.Repeat([]byte{2}, 32)
	if err := s.challenges.Create(ctx, user, oldCh, now.Add(-2*time.Hour)); err != nil {
		t.Fatal(err)
	}
	if err := s.challenges.Create(ctx, user, freshCh, now.Add(time.Minute)); err != nil {
		t.Fatal(err)
	}
	if n, err := s.challenges.PurgeChallenges(ctx, now.Add(-time.Hour), 100); err != nil || n != 1 {
		t.Fatalf("purged %d challenges, %v; want 1", n, err)
	}
	if ok, _ := s.challenges.Consume(ctx, user, freshCh, now); !ok {
		t.Error("the fresh challenge must survive")
	}

	idle, active := s.pki.NewDevice(t), s.pki.NewDevice(t)
	for dev, usedAt := range map[*appattesttest.Device]time.Time{idle: now.Add(-400 * 24 * time.Hour), active: now} {
		if ok, err := s.keys.Create(ctx, domain.Key{ID: dev.KeyID, UserID: user, BundleID: bundleID, PublicKey: &dev.Key.PublicKey, Environment: domain.EnvironmentProduction, CreatedAt: usedAt, LastUsedAt: usedAt}); err != nil || !ok {
			t.Fatalf("Create: %v %v", ok, err)
		}
	}
	if n, err := s.keys.PurgeKeys(ctx, now.Add(-365*24*time.Hour), 100); err != nil || n != 1 {
		t.Fatalf("purged %d keys, %v; want 1", n, err)
	}
	if _, ok, _ := s.keys.Get(ctx, idle.KeyID, user); ok {
		t.Error("the idle key must be purged")
	}
	if _, ok, _ := s.keys.Get(ctx, active.KeyID, user); !ok {
		t.Error("the active key must survive")
	}
}
