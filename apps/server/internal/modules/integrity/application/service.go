// Package application holds the integrity module's use case: verify a Play
// Integrity token for the authenticated caller.
package application

import (
	"context"
	"crypto/sha256"
	"errors"
	"time"

	"github.com/aedst/server/internal/modules/integrity/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// VerifyInput is one verification request. The token is a secret: nothing in
// this package logs it or puts it in an error.
type VerifyInput struct {
	UserID      ids.ID
	Token       string
	Action      string
	Payload     []byte
	RequestHash string
	// PackageName may be empty when exactly one package is allowed.
	PackageName string
}

// Result is the outcome. A rejected token is a normal result (Reason set), not an error.
type Result struct {
	Verified bool
	Reason   domain.Reason
	// Evidence is what Google reported; zero when the token was not decoded.
	Evidence domain.Evidence
	Decoded  bool
}

type Option func(*Service)

// WithLimiter caps verifications per user (Google's decode quota is shared by
// all users: 10,000 per day by default).
func WithLimiter(l Limiter, perMinute int) Option {
	return func(s *Service) { s.limiter, s.perMinute = l, perMinute }
}

type Service struct {
	decoder   Decoder
	replay    ReplayStore
	policy    domain.Policy
	clock     sharedtime.Clock
	limiter   Limiter
	perMinute int
}

// NewService builds the service. A nil decoder yields a disabled service whose
// Verify answers FAILED_PRECONDITION (the feature is off by default).
func NewService(decoder Decoder, replay ReplayStore, policy domain.Policy, clock sharedtime.Clock, opts ...Option) *Service {
	s := &Service{decoder: decoder, replay: replay, policy: policy, clock: clock}
	for _, o := range opts {
		o(s)
	}
	return s
}

// Enabled reports whether verification is configured.
func (s *Service) Enabled() bool { return s.decoder != nil }

// Verify decodes and judges one token.
func (s *Service) Verify(ctx context.Context, in VerifyInput) (Result, error) {
	const op = "integrity.Verify"
	if s.decoder == nil {
		return Result{}, sharederrors.FailedPrecondition(op, "play integrity verification is not configured on this server")
	}
	if in.Token == "" || !domain.ValidAction(in.Action) {
		return Result{}, sharederrors.Validation(op, "token and a valid action are required")
	}
	pkg, ok := s.policy.ResolvePackage(in.PackageName)
	if !ok {
		return Result{Reason: domain.ReasonPackageMismatch}, nil
	}

	if s.limiter != nil && s.perMinute > 0 {
		allowed, err := s.limiter.Allow(ctx, "integrity:verify:"+in.UserID.String(), s.perMinute, time.Minute)
		if err == nil && !allowed {
			return Result{}, sharederrors.RateLimited(op, "too many integrity verifications, retry later")
		}
	}

	// Cheap local check first: no Google call (and no quota) for a client that
	// computed the binding wrongly.
	expected := domain.RequestHash(in.Action, in.Payload)
	if !domain.HashesEqual(in.RequestHash, expected) {
		return Result{Reason: domain.ReasonRequestHashMismatch}, nil
	}

	evidence, err := s.decoder.Decode(ctx, pkg, in.Token)
	switch {
	case errors.Is(err, ErrUndecodable):
		return Result{Reason: domain.ReasonTokenUndecodable}, nil
	case err != nil:
		return Result{}, sharederrors.Wrap(op, err)
	}

	now := s.clock.Now()
	res := Result{Evidence: evidence, Decoded: true, Reason: s.policy.Evaluate(evidence, pkg, expected, now)}
	if res.Reason != domain.ReasonNone {
		return res, nil
	}

	// Last, so only a token that passed every check is consumed. The primary
	// key makes concurrent presentations of one token race to a single winner.
	first, err := s.replay.Claim(ctx, sha256.Sum256([]byte(in.Token)), in.UserID, now)
	if err != nil {
		return Result{}, sharederrors.Wrap(op, err)
	}
	if !first {
		res.Reason = domain.ReasonTokenReplayed
		return res, nil
	}
	res.Verified = true
	return res, nil
}
