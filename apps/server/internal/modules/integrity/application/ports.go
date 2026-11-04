package application

import (
	"context"
	"errors"
	"time"

	"github.com/aedst/server/internal/modules/integrity/domain"
	"github.com/aedst/server/internal/shared/ids"
)

// ErrUndecodable is returned by a Decoder when Google rejected the token itself
// (malformed, expired, minted for another project or package). Any other
// error is an operational failure (network, credentials, quota).
var ErrUndecodable = errors.New("integrity: token could not be decoded")

// Decoder turns an opaque Play Integrity token into evidence by asking Google
// (playintegrity.googleapis.com v1/{packageName}:decodeIntegrityToken).
type Decoder interface {
	Decode(ctx context.Context, packageName, token string) (domain.Evidence, error)
}

// ReplayStore records verified tokens so each is accepted once. Claim reports
// whether this call was the first to record tokenHash (SHA-256 of the token).
// It is the source of truth for replay protection, so it must be durable and
// shared by every replica (Postgres), never a cache.
type ReplayStore interface {
	Claim(ctx context.Context, tokenHash [32]byte, userID ids.ID, at time.Time) (bool, error)
}

// Limiter is a fixed-window rate limiter (satisfied by *valkey.RateLimiter).
// It fails open by design: an error means "allow".
type Limiter interface {
	Allow(ctx context.Context, key string, limit int, period time.Duration) (bool, error)
}
