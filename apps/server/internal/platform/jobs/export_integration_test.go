//go:build integration

package jobs

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"
)

// ReadQueueSnapshot exposes the metrics collector's cached read to the external
// integration test (which cannot live in this package: postgrestest imports it).
func ReadQueueSnapshot(ctx context.Context, pool *pgxpool.Pool, now time.Time) (counts map[string]int64, oldest time.Time, err error) {
	c := &queueCollector{pool: pool, ttl: time.Hour, now: func() time.Time { return now }}
	s, err := c.read(ctx)
	return s.counts, s.oldest, err
}

// RegisterMetricsForTest registers the gauges with a short cache TTL.
func RegisterMetricsForTest(pool *pgxpool.Pool) error {
	return registerMetrics(pool, time.Second, time.Now)
}
