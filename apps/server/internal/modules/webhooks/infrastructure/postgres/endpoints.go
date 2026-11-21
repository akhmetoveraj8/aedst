// Package postgres implements the webhooks module's storage against the
// sqlc-generated queries in gen/db/webhooks: the endpoint registry, the
// delivery log, the fan-out insert and what the delivery worker reads and
// writes. Not imported outside this module.
package postgres

import (
	"context"
	"encoding/json"
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	webhooksdb "github.com/aedst/server/gen/db/webhooks"
	"github.com/aedst/server/internal/modules/webhooks/application"
	"github.com/aedst/server/internal/modules/webhooks/domain"
	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/idempotency"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// JobInserter enqueues a River job inside the caller's transaction. Satisfied by
// the River client (platform/jobs.Client).
type JobInserter interface {
	InsertTx(ctx context.Context, tx pgx.Tx, args river.JobArgs, opts *river.InsertOpts) (*rivertype.JobInsertResult, error)
}

// Repository is the module's storage on one pool: the request pool for the
// operator API, the jobs pool for the fan-out, the worker and retention.
type Repository struct {
	pool        *pgxpool.Pool
	jobs        JobInserter
	idempotency idempotency.Store
}

var _ application.Repository = (*Repository)(nil)

// NewRepository builds a repository. jobs may be nil where nothing is enqueued
// (retention, the worker's own reads and writes).
func NewRepository(pool *pgxpool.Pool, jobs JobInserter) *Repository {
	return &Repository{pool: pool, jobs: jobs, idempotency: idempotency.NewPostgresStore()}
}

// createResult is what an idempotent CreateEndpoint remembers: the id of the
// row it created, never the secret.
type createResult struct {
	ID ids.ID `json:"id"`
}

func (r *Repository) CreateEndpoint(ctx context.Context, endpoint domain.Endpoint, sealed []byte, idem application.Idempotency) (domain.Endpoint, []byte, error) {
	const op = "webhooks.CreateEndpoint"
	// Hashed on the client-supplied fields only: the id, the timestamps and the
	// secret are generated fresh on every call, a retry included.
	request, err := json.Marshal(struct {
		URL         string   `json:"url"`
		Description string   `json:"description"`
		EventTypes  []string `json:"event_types"`
	}{endpoint.URL, endpoint.Description, endpoint.EventTypes})
	if err != nil {
		return domain.Endpoint{}, nil, sharederrors.Wrap(op, err)
	}
	var (
		out       domain.Endpoint
		outSealed []byte
	)
	err = database.WithTx(ctx, r.pool, func(ctx context.Context, tx pgx.Tx) error {
		q := webhooksdb.New(tx)
		cached, replay, err := idempotency.Check(ctx, tx, r.idempotency, idem.Scope, idem.Key, request)
		if err != nil {
			return err
		}
		if replay {
			var first createResult
			if err := json.Unmarshal(cached, &first); err != nil {
				return sharederrors.Wrap(op, err)
			}
			row, err := q.GetEndpoint(ctx, uuid(first.ID))
			if err != nil {
				return notFoundOr(op, "endpoint", err)
			}
			secret, err := q.GetEndpointSecret(ctx, uuid(first.ID))
			if err != nil {
				return notFoundOr(op, "endpoint", err)
			}
			out, outSealed = endpointFromRow(row), secret.SecretCiphertext
			return nil
		}
		row, err := q.CreateEndpoint(ctx, webhooksdb.CreateEndpointParams{
			ID: uuid(endpoint.ID), Url: endpoint.URL, Description: endpoint.Description,
			EventTypes: endpoint.EventTypes, SecretCiphertext: sealed, CreatedAt: timestamptz(endpoint.CreatedAt),
		})
		if err != nil {
			return sharederrors.Wrap(op, err)
		}
		out, outSealed = endpointFromRow(webhooksdb.GetEndpointRow(row)), sealed
		result, err := json.Marshal(createResult{ID: endpoint.ID})
		if err != nil {
			return sharederrors.Wrap(op, err)
		}
		return idempotency.Save(ctx, tx, r.idempotency, idem.Scope, idem.Key, request, result)
	})
	if err != nil {
		return domain.Endpoint{}, nil, err
	}
	return out, outSealed, nil
}

func (r *Repository) GetEndpoint(ctx context.Context, id ids.ID) (domain.Endpoint, error) {
	row, err := webhooksdb.New(r.pool).GetEndpoint(ctx, uuid(id))
	if err != nil {
		return domain.Endpoint{}, notFoundOr("webhooks.GetEndpoint", "endpoint", err)
	}
	return endpointFromRow(row), nil
}

func (r *Repository) ListEndpoints(ctx context.Context, limit int, after *pagination.Cursor) (domain.EndpointPage, error) {
	key, id := cursor(after)
	rows, err := webhooksdb.New(r.pool).ListEndpoints(ctx, webhooksdb.ListEndpointsParams{
		CursorKey: key, CursorID: id, PageLimit: int32(limit) + 1,
	})
	if err != nil {
		return domain.EndpointPage{}, sharederrors.Wrap("webhooks.ListEndpoints", err)
	}
	items := make([]domain.Endpoint, len(rows))
	for i, row := range rows {
		items[i] = endpointFromRow(webhooksdb.GetEndpointRow(row))
	}
	page := pagination.NewPage(items, limit, func(e domain.Endpoint) pagination.Cursor {
		return pagination.Cursor{Sort: domain.EndpointListOrder, Key: e.CreatedAt, ID: e.ID}
	})
	return domain.EndpointPage{Endpoints: page.Items, Next: page.Next}, nil
}

func (r *Repository) RotateSecret(ctx context.Context, id ids.ID, sealed []byte, now time.Time) (domain.Endpoint, error) {
	row, err := webhooksdb.New(r.pool).RotateEndpointSecret(ctx, webhooksdb.RotateEndpointSecretParams{
		ID: uuid(id), SecretCiphertext: sealed, UpdatedAt: timestamptz(now),
	})
	if err != nil {
		return domain.Endpoint{}, notFoundOr("webhooks.RotateEndpointSecret", "endpoint", err)
	}
	return endpointFromRow(webhooksdb.GetEndpointRow(row)), nil
}

func (r *Repository) DisableEndpoint(ctx context.Context, id ids.ID, reason domain.DisabledReason, now time.Time) (domain.Endpoint, error) {
	row, err := webhooksdb.New(r.pool).DisableEndpoint(ctx, webhooksdb.DisableEndpointParams{
		ID: uuid(id), DisabledReason: string(reason), UpdatedAt: timestamptz(now),
	})
	if errors.Is(err, pgx.ErrNoRows) {
		return r.GetEndpoint(ctx, id) // already disabled, or missing (NotFound)
	}
	if err != nil {
		return domain.Endpoint{}, sharederrors.Wrap("webhooks.DisableEndpoint", err)
	}
	return endpointFromRow(webhooksdb.GetEndpointRow(row)), nil
}

func (r *Repository) EnableEndpoint(ctx context.Context, id ids.ID, now time.Time) (domain.Endpoint, error) {
	row, err := webhooksdb.New(r.pool).EnableEndpoint(ctx, webhooksdb.EnableEndpointParams{ID: uuid(id), UpdatedAt: timestamptz(now)})
	if errors.Is(err, pgx.ErrNoRows) {
		return r.GetEndpoint(ctx, id) // already active, or missing (NotFound)
	}
	if err != nil {
		return domain.Endpoint{}, sharederrors.Wrap("webhooks.EnableEndpoint", err)
	}
	return endpointFromRow(webhooksdb.GetEndpointRow(row)), nil
}

func (r *Repository) DeleteEndpoint(ctx context.Context, id ids.ID) error {
	n, err := webhooksdb.New(r.pool).DeleteEndpoint(ctx, uuid(id))
	if err != nil {
		return sharederrors.Wrap("webhooks.DeleteEndpoint", err)
	}
	if n == 0 {
		return sharederrors.NotFound("webhooks.DeleteEndpoint", "endpoint not found")
	}
	return nil
}

// GetEndpointSecret loads an endpoint for a delivery; found is false when it
// was deleted.
func (r *Repository) GetEndpointSecret(ctx context.Context, id ids.ID) (secret domain.SealedEndpoint, found bool, err error) {
	row, err := webhooksdb.New(r.pool).GetEndpointSecret(ctx, uuid(id))
	if errors.Is(err, pgx.ErrNoRows) {
		return domain.SealedEndpoint{}, false, nil
	}
	if err != nil {
		return domain.SealedEndpoint{}, false, sharederrors.Wrap("webhooks.GetEndpointSecret", err)
	}
	return domain.SealedEndpoint{URL: row.Url, Active: row.Status == string(domain.EndpointActive), Sealed: row.SecretCiphertext}, true, nil
}
