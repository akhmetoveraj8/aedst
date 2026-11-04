// Package database wires the shared pgx connection pool and a small
// transaction helper. Modules never construct their own pool — they receive
// one from cmd/server and depend on the pgx interfaces (Querier-shaped) they
// need, not on this package's types directly, so infrastructure/postgres code
// stays testable against pgxmock or a real Testcontainers instance.
package database

import (
	"context"
	"errors"
	"fmt"
	"strconv"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgxpool"
)

// Pooler names the connection pooler between the server and PostgreSQL.
type Pooler string

const (
	// PoolerNone is a direct connection (or a pooler in session mode).
	PoolerNone Pooler = "none"
	// PoolerPgBouncer is PgBouncer (or the CloudNativePG Pooler) in
	// transaction-pooling mode: a server connection is only yours for one
	// transaction, so session state does not survive.
	PoolerPgBouncer Pooler = "pgbouncer"
)

// Config configures the pool. Kept separate from platform/config's
// DatabaseConfig so this package has no dependency on it.
type Config struct {
	DSN      string
	MaxConns int32
	MinConns int32

	// MaxConnLifetime and MaxConnIdleTime recycle connections (0 = pgx default).
	MaxConnLifetime time.Duration
	MaxConnIdleTime time.Duration
	// StatementTimeout and IdleInTxTimeout are applied server-side to every
	// session (0 = unlimited).
	StatementTimeout time.Duration
	IdleInTxTimeout  time.Duration
	// ApplicationName shows up in pg_stat_activity and logs.
	ApplicationName string
	// Pooler declares what sits in front of Postgres. PoolerPgBouncer forces
	// pgx onto QueryExecModeCacheDescribe whatever the DSN says: the default
	// QueryExecModeCacheStatement creates named server-side prepared
	// statements, which a transaction pooler may route to a different server
	// connection ("prepared statement ... does not exist"). It also stops
	// sending statement_timeout / idle_in_transaction_session_timeout as
	// startup parameters (PgBouncer ignores or rejects them); set those on the
	// role instead (ALTER ROLE ... SET).
	Pooler Pooler
}

// NewPool creates and verifies a pgx connection pool.
func NewPool(ctx context.Context, cfg Config) (*pgxpool.Pool, error) {
	poolCfg, err := pgxpool.ParseConfig(cfg.DSN)
	if err != nil {
		return nil, fmt.Errorf("database: parse dsn: %w", err)
	}
	if cfg.MaxConns > 0 {
		poolCfg.MaxConns = cfg.MaxConns
	}
	if cfg.MinConns > 0 {
		poolCfg.MinConns = cfg.MinConns
	}

	if cfg.MaxConnLifetime > 0 {
		poolCfg.MaxConnLifetime = cfg.MaxConnLifetime
		// Jitter avoids every connection expiring in the same instant.
		poolCfg.MaxConnLifetimeJitter = cfg.MaxConnLifetime / 10
	}
	if cfg.MaxConnIdleTime > 0 {
		poolCfg.MaxConnIdleTime = cfg.MaxConnIdleTime
	}
	poolCfg.HealthCheckPeriod = time.Minute
	applyPooler(poolCfg, cfg.Pooler)

	if poolCfg.ConnConfig.RuntimeParams == nil {
		poolCfg.ConnConfig.RuntimeParams = map[string]string{}
	}
	params := poolCfg.ConnConfig.RuntimeParams
	if cfg.ApplicationName != "" {
		params["application_name"] = cfg.ApplicationName
	}
	if cfg.StatementTimeout > 0 && cfg.Pooler != PoolerPgBouncer {
		params["statement_timeout"] = strconv.FormatInt(cfg.StatementTimeout.Milliseconds(), 10)
	}
	if cfg.IdleInTxTimeout > 0 && cfg.Pooler != PoolerPgBouncer {
		params["idle_in_transaction_session_timeout"] = strconv.FormatInt(cfg.IdleInTxTimeout.Milliseconds(), 10)
	}

	applyTracer(poolCfg, newTracer())
	pool, err := pgxpool.NewWithConfig(ctx, poolCfg)
	if err != nil {
		return nil, fmt.Errorf("database: create pool: %w", err)
	}

	if err := pool.Ping(ctx); err != nil {
		pool.Close()
		return nil, fmt.Errorf("database: ping: %w", err)
	}

	return pool, nil
}

// applyPooler adapts pgx to the pooler in front of Postgres.
func applyPooler(poolCfg *pgxpool.Config, p Pooler) {
	if p != PoolerPgBouncer {
		return
	}
	poolCfg.ConnConfig.DefaultQueryExecMode = pgx.QueryExecModeCacheDescribe
	// No named statements are created in this mode; only descriptions are
	// cached (the description cache must be enabled for it to work).
	poolCfg.ConnConfig.StatementCacheCapacity = 0
	if poolCfg.ConnConfig.DescriptionCacheCapacity <= 0 {
		poolCfg.ConnConfig.DescriptionCacheCapacity = 512
	}
}

// DirectPool is a pool known to talk to PostgreSQL directly (or through a
// session-mode pooler), so session state (LISTEN/NOTIFY, session advisory
// locks) survives between statements. Code that needs it (platform/lock) takes
// this type, which keeps it away from the transaction-pooled API pool.
type DirectPool struct {
	*pgxpool.Pool
}

// ErrPooledConnection is returned by NewDirectPool when asked to connect
// through a transaction pooler.
var ErrPooledConnection = errors.New("database: direct pool requested through a transaction pooler")

// NewDirectPool is NewPool for session-scoped work. It refuses a Config that
// declares a transaction pooler; point DSN at Postgres itself
// (AEDST_DATABASE_DIRECT_DSN).
func NewDirectPool(ctx context.Context, cfg Config) (*DirectPool, error) {
	if cfg.Pooler == PoolerPgBouncer {
		return nil, ErrPooledConnection
	}
	pool, err := NewPool(ctx, cfg)
	if err != nil {
		return nil, err
	}
	return &DirectPool{Pool: pool}, nil
}

// Querier is the subset of pgx's connection interface that sqlc-generated
// code needs. Repositories accept a Querier instead of *pgxpool.Pool
// directly so the same repository works inside or outside a transaction.
type Querier interface {
	Exec(ctx context.Context, sql string, args ...any) (pgconn.CommandTag, error)
	Query(ctx context.Context, sql string, args ...any) (pgx.Rows, error)
	QueryRow(ctx context.Context, sql string, args ...any) pgx.Row
}

// WithTx runs fn inside a transaction, committing on success and rolling back
// on error or panic. Transactions never span modules (see docs/content/server/database.md) —
// this only wraps a single module's pool.
func WithTx(ctx context.Context, pool *pgxpool.Pool, fn func(ctx context.Context, tx pgx.Tx) error) (err error) {
	tx, err := pool.Begin(ctx)
	if err != nil {
		return fmt.Errorf("database: begin tx: %w", err)
	}
	defer func() {
		if p := recover(); p != nil {
			_ = tx.Rollback(ctx)
			panic(p)
		}
		if err != nil {
			_ = tx.Rollback(ctx)
			return
		}
		err = tx.Commit(ctx)
	}()

	return fn(ctx, tx)
}
