package jobs

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// Stats is the read-only view of the queue that operator tooling (the admin
// module) shows. It is a port so the reader can live on the jobs pool, in this
// process or later in a service that owns River, instead of the admin module
// reading river_job through the request pool.
type Stats interface {
	// OldestAvailableAge is the delivery lag, see OldestAvailableAge.
	OldestAvailableAge(ctx context.Context, now time.Time) (time.Duration, error)
	// PendingCount is the number of jobs waiting to run or to be retried.
	PendingCount(ctx context.Context) (int64, error)
}

// PoolStats implements Stats over a Postgres pool (cmd/server passes the jobs pool).
type PoolStats struct{ pool *pgxpool.Pool }

// NewPoolStats reads queue statistics through pool.
func NewPoolStats(pool *pgxpool.Pool) *PoolStats { return &PoolStats{pool: pool} }

// OldestAvailableAge implements Stats.
func (s *PoolStats) OldestAvailableAge(ctx context.Context, now time.Time) (time.Duration, error) {
	return OldestAvailableAge(ctx, s.pool, now)
}

// PendingCount implements Stats.
func (s *PoolStats) PendingCount(ctx context.Context) (int64, error) {
	return PendingCount(ctx, s.pool)
}
