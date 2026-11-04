package idempotency

import (
	"context"
	"errors"
	"fmt"
	"math"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgconn"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	platformdb "github.com/aedst/server/gen/db/platform"
	"github.com/aedst/server/internal/platform/lock"
	sharederrors "github.com/aedst/server/internal/shared/errors"
)

// PostgresStore implements Store on the shared platform.idempotency_keys
// table. It is stateless: every method runs inside the command's own
// transaction.
type PostgresStore struct{}

var _ Store = PostgresStore{}

func NewPostgresStore() PostgresStore { return PostgresStore{} }

// Acquire serializes work on (scope, key). If the holder of the key does not finish
// before the statement timeout cancels the wait (SQLSTATE 57014), the caller gets a
// Conflict, which clients retry, instead of an opaque internal error: the same key is
// still being processed by another request.
func (PostgresStore) Acquire(ctx context.Context, tx pgx.Tx, scope, key string) error {
	if err := lock.Xact(ctx, tx, "idempotency:"+scope+":"+key); err != nil {
		var pgErr *pgconn.PgError
		if errors.As(err, &pgErr) && pgErr.Code == "57014" {
			return sharederrors.Conflict("idempotency.Acquire", "a request with this idempotency key is still being processed; retry shortly")
		}
		return fmt.Errorf("lock key: %w", err)
	}
	return nil
}

func (PostgresStore) Get(ctx context.Context, tx pgx.Tx, scope, key string) (result []byte, requestHash string, found bool, err error) {
	row, err := platformdb.New(tx).GetIdempotencyKey(ctx, platformdb.GetIdempotencyKeyParams{Scope: scope, Key: key})
	if errors.Is(err, pgx.ErrNoRows) {
		return nil, "", false, nil
	}
	if err != nil {
		return nil, "", false, fmt.Errorf("select: %w", err)
	}
	return row.Result, row.RequestHash, true, nil
}

func (PostgresStore) Save(ctx context.Context, tx pgx.Tx, scope, key, requestHash string, result []byte) error {
	// Acquire serialized concurrent writers, so a conflict here can only mean
	// a caller skipped Check; keep the first result then.
	err := platformdb.New(tx).SaveIdempotencyKey(ctx, platformdb.SaveIdempotencyKeyParams{
		Scope: scope, Key: key, RequestHash: requestHash, Result: result,
	})
	if err != nil {
		return fmt.Errorf("insert: %w", err)
	}
	return nil
}

// Purge deletes up to limit keys created before cutoff and returns how many
// it deleted. A key only needs to outlive a client's retry window.
func Purge(ctx context.Context, pool *pgxpool.Pool, cutoff time.Time, limit int) (int64, error) {
	n, err := platformdb.New(pool).PurgeIdempotencyKeys(ctx, platformdb.PurgeIdempotencyKeysParams{
		Cutoff:  pgtype.Timestamptz{Time: cutoff, Valid: true},
		MaxRows: int32(min(limit, math.MaxInt32)),
	})
	if err != nil {
		return 0, fmt.Errorf("idempotency: purge: %w", err)
	}
	return n, nil
}
