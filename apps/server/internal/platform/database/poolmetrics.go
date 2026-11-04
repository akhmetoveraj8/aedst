package database

import (
	"context"
	"fmt"

	"github.com/jackc/pgx/v5/pgxpool"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
)

// RegisterPoolMetrics exports pgxpool's own statistics as OpenTelemetry
// gauges/counters, labelled pool=<name> ("api", "jobs"):
//
//	aedst_db_pool_connections{pool,state=acquired|idle|total|max}
//	aedst_db_pool_acquire_total{pool}          successful acquires
//	aedst_db_pool_empty_acquire_total{pool}    acquires that had to wait: pool exhausted
//	aedst_db_pool_acquire_wait_seconds_total{pool}
//
// A rising empty-acquire rate or acquired == max is the earliest sign that a
// pool (not the database) is the bottleneck — see docs/content/server/scaling.md.
func RegisterPoolMetrics(name string, pool *pgxpool.Pool) error {
	meter := otel.Meter("github.com/aedst/server/internal/platform/database")
	poolAttr := attribute.String("pool", name)

	conns, err := meter.Int64ObservableGauge("aedst_db_pool_connections", metric.WithDescription("Connections in the pool by state."))
	if err != nil {
		return fmt.Errorf("database: pool metrics: %w", err)
	}
	acquires, err := meter.Int64ObservableCounter("aedst_db_pool_acquire_total", metric.WithDescription("Successful connection acquires."))
	if err != nil {
		return fmt.Errorf("database: pool metrics: %w", err)
	}
	empty, err := meter.Int64ObservableCounter("aedst_db_pool_empty_acquire_total", metric.WithDescription("Acquires that had to wait because the pool was exhausted."))
	if err != nil {
		return fmt.Errorf("database: pool metrics: %w", err)
	}
	wait, err := meter.Float64ObservableCounter("aedst_db_pool_acquire_wait_seconds_total", metric.WithUnit("s"), metric.WithDescription("Total time spent waiting to acquire a connection."))
	if err != nil {
		return fmt.Errorf("database: pool metrics: %w", err)
	}

	_, err = meter.RegisterCallback(func(_ context.Context, o metric.Observer) error {
		s := pool.Stat()
		o.ObserveInt64(conns, int64(s.AcquiredConns()), metric.WithAttributes(poolAttr, attribute.String("state", "acquired")))
		o.ObserveInt64(conns, int64(s.IdleConns()), metric.WithAttributes(poolAttr, attribute.String("state", "idle")))
		o.ObserveInt64(conns, int64(s.TotalConns()), metric.WithAttributes(poolAttr, attribute.String("state", "total")))
		o.ObserveInt64(conns, int64(s.MaxConns()), metric.WithAttributes(poolAttr, attribute.String("state", "max")))
		o.ObserveInt64(acquires, s.AcquireCount(), metric.WithAttributes(poolAttr))
		o.ObserveInt64(empty, s.EmptyAcquireCount(), metric.WithAttributes(poolAttr))
		o.ObserveFloat64(wait, s.AcquireDuration().Seconds(), metric.WithAttributes(poolAttr))
		return nil
	}, conns, acquires, empty, wait)
	if err != nil {
		return fmt.Errorf("database: pool metrics: %w", err)
	}
	return nil
}
