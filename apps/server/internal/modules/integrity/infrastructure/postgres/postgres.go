// Package postgres implements replay protection on PostgreSQL: the primary key
// of integrity.verified_tokens is the single source of truth.
package postgres

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	integritydb "github.com/aedst/server/gen/db/integrity"
	"github.com/aedst/server/internal/modules/integrity/application"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type Repository struct {
	pool *pgxpool.Pool
}

func NewRepository(pool *pgxpool.Pool) *Repository { return &Repository{pool: pool} }

var _ application.ReplayStore = (*Repository)(nil)

// Claim records tokenHash; false means it was already recorded (a replay).
func (r *Repository) Claim(ctx context.Context, tokenHash [32]byte, userID ids.ID, at time.Time) (bool, error) {
	n, err := integritydb.New(r.pool).ClaimToken(ctx, integritydb.ClaimTokenParams{
		TokenHash:  tokenHash[:],
		UserID:     pgtype.UUID{Bytes: userID, Valid: !userID.IsNil()},
		VerifiedAt: pgtype.Timestamptz{Time: at, Valid: true},
	})
	if err != nil {
		return false, sharederrors.Wrap("integrity.Claim", err)
	}
	return n == 1, nil
}

// PurgeOlderThan deletes up to limit rows older than cutoff. The cutoff must
// exceed the policy's token max age, or an expired-looking row could free a
// token that is still fresh (retention is configured accordingly).
func (r *Repository) PurgeOlderThan(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
	n, err := integritydb.New(r.pool).PurgeVerifiedTokens(ctx, integritydb.PurgeVerifiedTokensParams{
		Cutoff: pgtype.Timestamptz{Time: cutoff, Valid: true}, RowLimit: int32(limit),
	})
	if err != nil {
		return 0, sharederrors.Wrap("integrity.Purge", err)
	}
	return n, nil
}
