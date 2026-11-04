package application

import (
	"context"
	"time"

	"github.com/aedst/server/internal/modules/appattest/domain"
	"github.com/aedst/server/internal/shared/ids"
)

// Attester validates an App Attest attestation object (Apple's checklist:
// format, certificate chain to the Apple root, nonce, key id, authenticator
// data). It is pure computation: a rejected attestation is a Reason, never an
// error.
type Attester interface {
	VerifyAttestation(in domain.AttestationInput) (domain.Attested, domain.Reason)
}

// Asserter validates an App Attest assertion against an enrolled key: RP ID
// hash and signature. It returns the assertion counter; judging whether that
// counter is fresh needs state and is the KeyStore's job.
type Asserter interface {
	VerifyAssertion(in domain.AssertionInput) (counter uint32, reason domain.Reason)
}

// ChallengeStore keeps single-use challenges. It is the source of truth for
// "usable once", so it must be durable and shared by every replica (Postgres),
// never a cache.
type ChallengeStore interface {
	Create(ctx context.Context, userID ids.ID, challenge []byte, expiresAt time.Time) error
	// Consume spends a challenge issued to userID that is unspent and unexpired
	// at now. False means unknown, expired, already used or someone else's.
	Consume(ctx context.Context, userID ids.ID, challenge []byte, now time.Time) (bool, error)
}

// KeyStore keeps attested keys and their assertion counters.
type KeyStore interface {
	// Create stores a new key with counter 0. False means the key id is already enrolled.
	Create(ctx context.Context, key domain.Key) (bool, error)
	// Get returns the key when it is enrolled for userID and not revoked.
	Get(ctx context.Context, keyID []byte, userID ids.ID) (domain.Key, bool, error)
	// AdvanceCounter atomically moves the stored counter to newCounter if and
	// only if it is strictly greater. False means a replay (or a missing key).
	AdvanceCounter(ctx context.Context, keyID []byte, userID ids.ID, newCounter uint32, now time.Time) (bool, error)
}

// Limiter is a fixed-window rate limiter (satisfied by *valkey.RateLimiter).
// It fails open by design: an error means "allow".
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, period time.Duration) (bool, error)
}
