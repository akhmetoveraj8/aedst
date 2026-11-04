// Package idempotency lets a command handler safely replay a client retry
// of the same request instead of executing it twice. A client sends an
// Idempotency-Key header; the handler looks it up inside the same
// transaction as its own write, and either proceeds (first time) or returns
// the previously computed result (retry) — the check, the write, and the
// save all commit atomically, so there's no window where a crash between
// "did the work" and "recorded the key" could let a retry redo it.
//
// Keys are namespaced by a scope (module + caller, e.g. "tasks:<user id>"), so
// two callers can neither collide on nor probe each other's keys.
//
// Concurrent requests carrying the same key are serialized: Check first takes
// a transaction-scoped advisory lock on (scope, key), so the second request
// waits for the first to commit and then replays its result, instead of both
// passing the lookup and both doing the work.
package idempotency

import (
	"context"
	"crypto/sha256"
	"encoding/hex"
	"fmt"

	"github.com/jackc/pgx/v5"

	sharederrors "github.com/aedst/server/internal/shared/errors"
)

// Store persists idempotency keys. PostgresStore is the implementation.
type Store interface {
	// Acquire serializes concurrent requests for (scope, key) until tx ends.
	Acquire(ctx context.Context, tx pgx.Tx, scope, key string) error
	Get(ctx context.Context, tx pgx.Tx, scope, key string) (result []byte, requestHash string, found bool, err error)
	Save(ctx context.Context, tx pgx.Tx, scope, key, requestHash string, result []byte) error
}

// HashRequest returns a hex SHA-256 digest of payload, used to detect a
// client reusing the same idempotency key for a different request.
func HashRequest(payload []byte) string {
	sum := sha256.Sum256(payload)
	return hex.EncodeToString(sum[:])
}

// Check looks up key inside tx. A miss returns (nil, false, nil): the caller
// should proceed and call Save before its transaction commits. A hit with a
// matching request hash returns (cachedResult, true, nil): the caller should
// return cachedResult without redoing the work. A hit with a different hash
// is key reuse with a different payload and returns a Conflict error.
func Check(ctx context.Context, tx pgx.Tx, store Store, scope, key string, requestPayload []byte) (result []byte, replay bool, err error) {
	if key == "" {
		return nil, false, nil
	}

	if err := store.Acquire(ctx, tx, scope, key); err != nil {
		return nil, false, fmt.Errorf("idempotency: acquire: %w", err)
	}
	cached, hash, found, err := store.Get(ctx, tx, scope, key)
	if err != nil {
		return nil, false, fmt.Errorf("idempotency: get: %w", err)
	}
	if !found {
		return nil, false, nil
	}

	if hash != HashRequest(requestPayload) {
		return nil, false, sharederrors.Conflict("idempotency.Check", "idempotency key reused with a different request")
	}
	return cached, true, nil
}

// Save records key alongside requestPayload's hash and the computed result.
// A no-op when key is empty, so callers can pass an optional key through
// unconditionally.
func Save(ctx context.Context, tx pgx.Tx, store Store, scope, key string, requestPayload, result []byte) error {
	if key == "" {
		return nil
	}
	if err := store.Save(ctx, tx, scope, key, HashRequest(requestPayload), result); err != nil {
		return fmt.Errorf("idempotency: save: %w", err)
	}
	return nil
}
