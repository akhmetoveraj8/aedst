// Package postgres stores App Attest challenges and keys. Single use of a
// challenge and the monotonic assertion counter are each decided by one SQL
// statement, so they hold across every replica.
package postgres

import (
	"context"
	"crypto/ecdsa"
	"crypto/x509"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"
	"github.com/jackc/pgx/v5/pgxpool"

	appattestdb "github.com/aedst/server/gen/db/appattest"
	"github.com/aedst/server/internal/modules/appattest/application"
	"github.com/aedst/server/internal/modules/appattest/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// ChallengeRepository implements application.ChallengeStore.
type ChallengeRepository struct {
	pool *pgxpool.Pool
}

func NewChallengeRepository(pool *pgxpool.Pool) *ChallengeRepository {
	return &ChallengeRepository{pool: pool}
}

// KeyRepository implements application.KeyStore.
type KeyRepository struct {
	pool *pgxpool.Pool
}

func NewKeyRepository(pool *pgxpool.Pool) *KeyRepository { return &KeyRepository{pool: pool} }

var (
	_ application.ChallengeStore = (*ChallengeRepository)(nil)
	_ application.KeyStore       = (*KeyRepository)(nil)
)

func uuidOf(id ids.ID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: !id.IsNil()} }

func ts(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

// Create stores a new challenge.
func (r *ChallengeRepository) Create(ctx context.Context, userID ids.ID, challenge []byte, expiresAt time.Time) error {
	err := appattestdb.New(r.pool).CreateChallenge(ctx, appattestdb.CreateChallengeParams{
		ID: uuidOf(ids.New()), UserID: uuidOf(userID), Challenge: challenge, ExpiresAt: ts(expiresAt),
	})
	if err != nil {
		return sharederrors.Wrap("appattest.CreateChallenge", err)
	}
	return nil
}

// Consume spends a challenge: true only for the first call, by the user it was issued to, before expiry.
func (r *ChallengeRepository) Consume(ctx context.Context, userID ids.ID, challenge []byte, now time.Time) (bool, error) {
	n, err := appattestdb.New(r.pool).ConsumeChallenge(ctx, appattestdb.ConsumeChallengeParams{
		Now: ts(now), UserID: uuidOf(userID), Challenge: challenge,
	})
	if err != nil {
		return false, sharederrors.Wrap("appattest.ConsumeChallenge", err)
	}
	return n == 1, nil
}

// PurgeChallenges deletes up to limit challenges that expired before cutoff.
func (r *ChallengeRepository) PurgeChallenges(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
	n, err := appattestdb.New(r.pool).PurgeChallenges(ctx, appattestdb.PurgeChallengesParams{Cutoff: ts(cutoff), RowLimit: int32(limit)})
	if err != nil {
		return 0, sharederrors.Wrap("appattest.PurgeChallenges", err)
	}
	return n, nil
}

// Create stores a new key; false means the key id is already enrolled.
func (k *KeyRepository) Create(ctx context.Context, key domain.Key) (bool, error) {
	der, err := x509.MarshalPKIXPublicKey(key.PublicKey)
	if err != nil {
		return false, sharederrors.Wrap("appattest.CreateKey", err)
	}
	n, err := appattestdb.New(k.pool).InsertKey(ctx, appattestdb.InsertKeyParams{
		KeyID: key.ID, UserID: uuidOf(key.UserID), BundleID: key.BundleID, PublicKey: der,
		Environment: string(key.Environment), CreatedAt: ts(key.CreatedAt),
	})
	if err != nil {
		return false, sharederrors.Wrap("appattest.CreateKey", err)
	}
	return n == 1, nil
}

// Get returns the key when it is enrolled for userID and not revoked.
func (k *KeyRepository) Get(ctx context.Context, keyID []byte, userID ids.ID) (domain.Key, bool, error) {
	row, err := appattestdb.New(k.pool).GetKey(ctx, appattestdb.GetKeyParams{KeyID: keyID, UserID: uuidOf(userID)})
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.Key{}, false, nil
	}
	if err != nil {
		return domain.Key{}, false, sharederrors.Wrap("appattest.GetKey", err)
	}
	parsed, err := x509.ParsePKIXPublicKey(row.PublicKey)
	pub, ok := parsed.(*ecdsa.PublicKey)
	if err != nil || !ok {
		return domain.Key{}, false, sharederrors.Wrap("appattest.GetKey", errors.New("stored public key is not an ECDSA key"))
	}
	return domain.Key{
		ID:          row.KeyID,
		UserID:      userID,
		BundleID:    row.BundleID,
		PublicKey:   pub,
		Counter:     uint32(row.Counter),
		Environment: domain.Environment(row.Environment),
		CreatedAt:   row.CreatedAt.Time,
		LastUsedAt:  row.LastUsedAt.Time,
	}, true, nil
}

// AdvanceCounter moves the counter forward in one compare-and-set statement.
func (k *KeyRepository) AdvanceCounter(ctx context.Context, keyID []byte, userID ids.ID, newCounter uint32, now time.Time) (bool, error) {
	n, err := appattestdb.New(k.pool).AdvanceCounter(ctx, appattestdb.AdvanceCounterParams{
		NewCounter: int64(newCounter), Now: ts(now), KeyID: keyID, UserID: uuidOf(userID),
	})
	if err != nil {
		return false, sharederrors.Wrap("appattest.AdvanceCounter", err)
	}
	return n == 1, nil
}

// PurgeKeys deletes up to limit keys not used since cutoff (their apps re-enroll).
func (k *KeyRepository) PurgeKeys(ctx context.Context, cutoff time.Time, limit int) (int64, error) {
	n, err := appattestdb.New(k.pool).PurgeKeys(ctx, appattestdb.PurgeKeysParams{Cutoff: ts(cutoff), RowLimit: int32(limit)})
	if err != nil {
		return 0, sharederrors.Wrap("appattest.PurgeKeys", err)
	}
	return n, nil
}
