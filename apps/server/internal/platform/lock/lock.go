// Package lock provides cluster-wide mutual exclusion on top of PostgreSQL
// advisory locks. It replaces distributed-lock libraries (Redlock/RedSync
// and similar): the database is already the system of record and a hard
// dependency of every replica, so a lock that lives in the same failure
// domain as the data it protects is both simpler and safer than one held in
// a separate cache/broker.
//
// Two flavours:
//
//   - Transaction-scoped (TryXact / Xact): the lock is released automatically
//     at COMMIT/ROLLBACK. Preferred — it cannot leak, and it works behind
//     PgBouncer in transaction-pooling mode.
//   - Session-scoped (TryLock / WithLock): held on a dedicated pooled
//     connection until released. Use only for work that must span several
//     transactions; never behind a transaction-pooling proxy.
//
// Lock names are arbitrary strings hashed by PostgreSQL itself
// (hashtextextended) into the 64-bit advisory-lock keyspace, so callers never
// juggle integer keys. Namespace names per module, e.g. "tasks:nightly-sweep".
//
// For periodic/leader-only background work prefer River's own leader
// election and unique jobs (internal/platform/jobs); reach for this package
// only when neither fits. Per-request deduplication belongs to
// internal/platform/idempotency, not to a lock.
package lock

import (
	"context"
	"errors"
	"fmt"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"

	"github.com/aedst/server/internal/platform/database"
)

// ErrNotAcquired is returned by WithTryLock when the lock is held elsewhere.
var ErrNotAcquired = errors.New("lock: not acquired")

// Locker acquires session-scoped advisory locks from a pgx pool.
type Locker struct {
	pool *pgxpool.Pool
}

// NewLocker builds a Locker. It takes a database.DirectPool on purpose: a
// session-level advisory lock taken through a transaction pooler (PgBouncer)
// stays on whichever server connection happened to serve that transaction and
// is later handed to an unrelated client, so the lock leaks or is never
// released. Build the pool with database.NewDirectPool (it refuses a
// transaction-pooled Config) on AEDST_DATABASE_DIRECT_DSN, never from the API
// pool. Prefer TryXact/Xact, which are safe behind a pooler.
func NewLocker(pool *database.DirectPool) *Locker {
	return &Locker{pool: pool.Pool}
}

// TryXact attempts to take the transaction-scoped advisory lock name inside
// tx without blocking. The lock is released when tx ends.
func TryXact(ctx context.Context, tx pgx.Tx, name string) (bool, error) {
	var ok bool
	if err := tx.QueryRow(ctx, `SELECT pg_try_advisory_xact_lock(hashtextextended($1, 0))`, name).Scan(&ok); err != nil {
		return false, fmt.Errorf("lock: try xact %q: %w", name, err)
	}
	return ok, nil
}

// Xact blocks until the transaction-scoped advisory lock name is acquired
// inside tx (or ctx is done). The lock is released when tx ends.
func Xact(ctx context.Context, tx pgx.Tx, name string) error {
	if _, err := tx.Exec(ctx, `SELECT pg_advisory_xact_lock(hashtextextended($1, 0))`, name); err != nil {
		return fmt.Errorf("lock: xact %q: %w", name, err)
	}
	return nil
}

// TryLock attempts to take the session-scoped advisory lock name without
// blocking. On success it returns a release function that must be called
// exactly once (typically deferred). When the lock is held elsewhere it
// returns (nil, false, nil).
func (l *Locker) TryLock(ctx context.Context, name string) (release func(), acquired bool, err error) {
	conn, err := l.pool.Acquire(ctx)
	if err != nil {
		return nil, false, fmt.Errorf("lock: acquire connection: %w", err)
	}

	var ok bool
	if err := conn.QueryRow(ctx, `SELECT pg_try_advisory_lock(hashtextextended($1, 0))`, name).Scan(&ok); err != nil {
		conn.Release()
		return nil, false, fmt.Errorf("lock: try %q: %w", name, err)
	}
	if !ok {
		conn.Release()
		return nil, false, nil
	}
	return releaseFunc(ctx, conn, name), true, nil
}

// Lock blocks until the session-scoped advisory lock name is acquired or ctx
// is done, then returns the release function. The wait is subject to the
// session statement_timeout (AEDST_DATABASE_STATEMENT_TIMEOUT_MS), so prefer
// TryLock/WithTryLock for anything that may contend for long.
func (l *Locker) Lock(ctx context.Context, name string) (release func(), err error) {
	conn, err := l.pool.Acquire(ctx)
	if err != nil {
		return nil, fmt.Errorf("lock: acquire connection: %w", err)
	}
	if _, err := conn.Exec(ctx, `SELECT pg_advisory_lock(hashtextextended($1, 0))`, name); err != nil {
		// A cancelled blocking query may leave the lock request pending on the
		// server; dropping the connection guarantees it cannot be granted later.
		_ = conn.Conn().Close(context.WithoutCancel(ctx))
		conn.Release()
		return nil, fmt.Errorf("lock: acquire %q: %w", name, err)
	}
	return releaseFunc(ctx, conn, name), nil
}

// WithTryLock runs fn while holding the session-scoped lock name, or returns
// ErrNotAcquired without running fn if another holder has it.
func (l *Locker) WithTryLock(ctx context.Context, name string, fn func(ctx context.Context) error) error {
	release, ok, err := l.TryLock(ctx, name)
	if err != nil {
		return err
	}
	if !ok {
		return ErrNotAcquired
	}
	defer release()
	return fn(ctx)
}

func releaseFunc(ctx context.Context, conn *pgxpool.Conn, name string) func() {
	// Detach cancellation: release must succeed even when the caller's
	// context is already cancelled (the usual reason we are releasing), while
	// keeping its values (trace).
	detached := context.WithoutCancel(ctx)
	return func() {
		var unlocked bool
		err := conn.QueryRow(detached, `SELECT pg_advisory_unlock(hashtextextended($1, 0))`, name).Scan(&unlocked)
		if err != nil || !unlocked {
			// Unknown lock state: destroy the session so PostgreSQL drops any
			// advisory lock it still holds instead of returning a locked
			// connection to the pool.
			_ = conn.Conn().Close(detached)
		}
		conn.Release()
	}
}
