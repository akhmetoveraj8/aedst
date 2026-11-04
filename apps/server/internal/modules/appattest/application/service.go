// Package application holds the appattest module's use cases: issue a
// challenge, enroll an attested key, verify an assertion.
package application

import (
	"context"
	"crypto/rand"
	"crypto/sha256"
	"log/slog"
	"time"

	"github.com/aedst/server/internal/modules/appattest/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// Challenge is a freshly issued challenge.
type Challenge struct {
	Value     []byte
	ExpiresAt time.Time
}

// EnrollInput is one enrollment request. AttestationObject and Challenge are
// secrets: nothing in this package logs them or puts them in an error.
type EnrollInput struct {
	UserID            ids.ID
	KeyID             string
	AttestationObject []byte
	Challenge         []byte
	// BundleID may be empty when exactly one bundle id is allowed.
	BundleID string
}

// EnrollResult is the outcome of an enrollment. A rejection is a normal
// result (Reason set), not an error.
type EnrollResult struct {
	Verified    bool
	Reason      domain.Reason
	Environment domain.Environment
}

// AssertionInput is one assertion to verify.
type AssertionInput struct {
	UserID    ids.ID
	KeyID     string
	Assertion []byte
	Action    string
	Payload   []byte
}

// AssertionResult is the outcome of a verification.
type AssertionResult struct {
	Verified bool
	Reason   domain.Reason
}

type Option func(*Service)

// WithLimiter caps challenge/enrollment calls and assertion verifications per
// user per minute. A zero limit disables that cap.
func WithLimiter(l Limiter, enrollPerMinute, assertPerMinute int) Option {
	return func(s *Service) {
		s.limiter, s.enrollPerMinute, s.assertPerMinute = l, enrollPerMinute, assertPerMinute
	}
}

type Service struct {
	attester   Attester
	asserter   Asserter
	challenges ChallengeStore
	keys       KeyStore
	policy     domain.Policy
	clock      sharedtime.Clock

	limiter         Limiter
	enrollPerMinute int
	assertPerMinute int
}

// NewService builds the service. A nil attester yields a disabled service
// whose methods answer FAILED_PRECONDITION (the feature is off by default).
func NewService(attester Attester, asserter Asserter, challenges ChallengeStore, keys KeyStore, policy domain.Policy, clock sharedtime.Clock, opts ...Option) *Service {
	s := &Service{attester: attester, asserter: asserter, challenges: challenges, keys: keys, policy: policy, clock: clock}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Enabled reports whether verification is configured.
func (s *Service) Enabled() bool { return s.attester != nil }

func (s *Service) disabled(op string) error {
	return sharederrors.FailedPrecondition(op, "app attest verification is not configured on this server")
}

func (s *Service) limit(ctx context.Context, op, bucket string, userID ids.ID, perMinute int) error {
	if s.limiter == nil || perMinute <= 0 {
		return nil
	}
	allowed, err := s.limiter.Allow(ctx, "appattest:"+bucket+":"+userID.String(), perMinute, time.Minute)
	if err != nil {
		// Fail open by design (the limiter is not a security boundary), but never silently.
		slog.WarnContext(ctx, "app attest rate limiter unavailable, allowing the request", "bucket", bucket, "error", err)
		return nil
	}
	if !allowed {
		return sharederrors.RateLimited(op, "too many app attest requests, retry later")
	}
	return nil
}

// CreateChallenge issues a single-use challenge bound to the user.
func (s *Service) CreateChallenge(ctx context.Context, userID ids.ID) (Challenge, error) {
	const op = "appattest.CreateChallenge"
	if !s.Enabled() {
		return Challenge{}, s.disabled(op)
	}
	if err := s.limit(ctx, op, "enroll", userID, s.enrollPerMinute); err != nil {
		return Challenge{}, err
	}
	value := make([]byte, domain.ChallengeSize)
	_, _ = rand.Read(value) // crypto/rand.Read never returns an error (Go 1.24+: it crashes the program instead)
	expires := s.clock.Now().Add(domain.ChallengeTTL)
	if err := s.challenges.Create(ctx, userID, value, expires); err != nil {
		return Challenge{}, sharederrors.Wrap(op, err)
	}
	return Challenge{Value: value, ExpiresAt: expires}, nil
}

// Enroll validates an attestation and stores the attested key.
//
// The challenge is spent before the attestation is examined, so a challenge
// can never be used for a second guess: a failed enrollment needs a new
// challenge. Spending it and storing the key are separate statements; if the
// store fails after the challenge was spent the client simply starts over.
func (s *Service) Enroll(ctx context.Context, in EnrollInput) (EnrollResult, error) {
	const op = "appattest.Enroll"
	if !s.Enabled() {
		return EnrollResult{}, s.disabled(op)
	}
	keyID, err := domain.DecodeKeyID(in.KeyID)
	if err != nil || len(in.AttestationObject) == 0 || len(in.Challenge) != domain.ChallengeSize {
		return EnrollResult{}, sharederrors.Validation(op, "key id, attestation object and a 32-byte challenge are required")
	}
	bundle, ok := s.policy.ResolveBundle(in.BundleID)
	if !ok {
		return rejectEnroll(ctx, domain.ReasonBundleNotAllowed), nil
	}
	if err := s.limit(ctx, op, "enroll", in.UserID, s.enrollPerMinute); err != nil {
		return EnrollResult{}, err
	}

	now := s.clock.Now()
	spent, err := s.challenges.Consume(ctx, in.UserID, in.Challenge, now)
	if err != nil {
		return EnrollResult{}, sharederrors.Wrap(op, err)
	}
	if !spent {
		return rejectEnroll(ctx, domain.ReasonChallengeInvalid), nil
	}

	clientDataHash := sha256.Sum256(in.Challenge) // what attestKey was given
	attested, reason := s.attester.VerifyAttestation(domain.AttestationInput{
		Object:         in.AttestationObject,
		ClientDataHash: clientDataHash[:],
		KeyID:          keyID,
		AppID:          s.policy.AppID(bundle),
	})
	if reason != domain.ReasonNone {
		return rejectEnroll(ctx, reason), nil
	}
	if !s.policy.EnvironmentAllowed(attested.Environment) {
		return rejectEnroll(ctx, domain.ReasonEnvironmentNotAllowed), nil
	}

	created, err := s.keys.Create(ctx, domain.Key{
		ID:          keyID,
		UserID:      in.UserID,
		BundleID:    bundle,
		PublicKey:   attested.PublicKey,
		Counter:     0,
		Environment: attested.Environment,
		CreatedAt:   now,
		LastUsedAt:  now,
	})
	if err != nil {
		return EnrollResult{}, sharederrors.Wrap(op, err)
	}
	if !created {
		return rejectEnroll(ctx, domain.ReasonKeyAlreadyEnrolled), nil
	}
	slog.InfoContext(ctx, "app attest key enrolled", "environment", string(attested.Environment))
	return EnrollResult{Verified: true, Environment: attested.Environment}, nil
}

func rejectEnroll(ctx context.Context, reason domain.Reason) EnrollResult {
	slog.InfoContext(ctx, "app attest enrollment rejected", "reason", string(reason))
	return EnrollResult{Reason: reason}
}

// VerifyAssertion checks an assertion made with an enrolled key and, only when
// every check passed, advances the key's counter.
func (s *Service) VerifyAssertion(ctx context.Context, in AssertionInput) (AssertionResult, error) {
	const op = "appattest.VerifyAssertion"
	if !s.Enabled() {
		return AssertionResult{}, s.disabled(op)
	}
	keyID, err := domain.DecodeKeyID(in.KeyID)
	if err != nil || len(in.Assertion) == 0 || !domain.ValidAction(in.Action) {
		return AssertionResult{}, sharederrors.Validation(op, "key id, assertion and a valid action are required")
	}
	if err := s.limit(ctx, op, "assert", in.UserID, s.assertPerMinute); err != nil {
		return AssertionResult{}, err
	}

	// One lookup answers "unknown", "revoked" and "someone else's key" alike.
	key, found, err := s.keys.Get(ctx, keyID, in.UserID)
	if err != nil {
		return AssertionResult{}, sharederrors.Wrap(op, err)
	}
	if !found {
		return rejectAssertion(ctx, domain.ReasonKeyUnknown), nil
	}
	if !s.policy.BundleAllowed(key.BundleID) {
		return rejectAssertion(ctx, domain.ReasonBundleNotAllowed), nil
	}
	// Policy changes apply to keys enrolled earlier: a development key must stop
	// working once AllowDevelopment is switched off (same rule as the bundle list).
	if !s.policy.EnvironmentAllowed(key.Environment) {
		return rejectAssertion(ctx, domain.ReasonEnvironmentNotAllowed), nil
	}

	counter, reason := s.asserter.VerifyAssertion(domain.AssertionInput{
		Object:         in.Assertion,
		ClientDataHash: domain.ClientDataHash(in.Action, in.Payload),
		PublicKey:      key.PublicKey,
		AppID:          s.policy.AppID(key.BundleID),
	})
	if reason != domain.ReasonNone {
		return rejectAssertion(ctx, reason), nil
	}
	// Cheap early exit; the statement below is what decides under concurrency.
	if counter <= key.Counter {
		return rejectAssertion(ctx, domain.ReasonCounterNotIncreasing), nil
	}
	advanced, err := s.keys.AdvanceCounter(ctx, keyID, in.UserID, counter, s.clock.Now())
	if err != nil {
		return AssertionResult{}, sharederrors.Wrap(op, err)
	}
	if !advanced {
		return rejectAssertion(ctx, domain.ReasonCounterNotIncreasing), nil
	}
	return AssertionResult{Verified: true}, nil
}

func rejectAssertion(ctx context.Context, reason domain.Reason) AssertionResult {
	slog.InfoContext(ctx, "app attest assertion rejected", "reason", string(reason))
	return AssertionResult{Reason: reason}
}
