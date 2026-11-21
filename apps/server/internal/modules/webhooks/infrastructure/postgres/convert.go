package postgres

import (
	"errors"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/jackc/pgx/v5/pgtype"

	webhooksdb "github.com/aedst/server/gen/db/webhooks"
	"github.com/aedst/server/internal/modules/webhooks/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// Every endpoint query returns the same columns, so its row type converts to
// GetEndpointRow; the same holds for deliveries and GetDeliveryRow.
func endpointFromRow(row webhooksdb.GetEndpointRow) domain.Endpoint {
	return domain.Endpoint{
		ID:                  ids.ID(row.ID.Bytes),
		URL:                 row.Url,
		Description:         row.Description,
		EventTypes:          row.EventTypes,
		Status:              domain.EndpointStatus(row.Status),
		DisabledReason:      domain.DisabledReason(row.DisabledReason),
		ConsecutiveFailures: int(row.ConsecutiveFailures),
		CreatedAt:           row.CreatedAt.Time,
		UpdatedAt:           row.UpdatedAt.Time,
	}
}

func deliveryFromRow(row webhooksdb.GetDeliveryRow) domain.Delivery {
	d := domain.Delivery{
		ID:             ids.ID(row.ID.Bytes),
		EndpointID:     ids.ID(row.EndpointID.Bytes),
		EventID:        ids.ID(row.EventID.Bytes),
		EventType:      row.EventType,
		Status:         domain.DeliveryStatus(row.Status),
		Attempts:       int(row.Attempts),
		LastStatusCode: int(row.LastStatusCode),
		LastError:      row.LastError,
		CreatedAt:      row.CreatedAt.Time,
		UpdatedAt:      row.UpdatedAt.Time,
	}
	if row.DeliveredAt.Valid {
		at := row.DeliveredAt.Time
		d.DeliveredAt = &at
	}
	return d
}

func uuid(id ids.ID) pgtype.UUID { return pgtype.UUID{Bytes: id, Valid: true} }

func toUUIDs(in []ids.ID) []pgtype.UUID {
	out := make([]pgtype.UUID, len(in))
	for i, id := range in {
		out[i] = uuid(id)
	}
	return out
}

func fromUUIDs(in []pgtype.UUID) []ids.ID {
	out := make([]ids.ID, len(in))
	for i, id := range in {
		out[i] = ids.ID(id.Bytes)
	}
	return out
}

func timestamptz(t time.Time) pgtype.Timestamptz { return pgtype.Timestamptz{Time: t, Valid: true} }

// cursor returns the keyset position to resume after. The first page passes an
// open cursor (infinity, max uuid) that every row sorts before (DESC).
func cursor(after *pagination.Cursor) (pgtype.Timestamptz, pgtype.UUID) {
	if after == nil {
		open := pgtype.UUID{Valid: true}
		for i := range open.Bytes {
			open.Bytes[i] = 0xff
		}
		return pgtype.Timestamptz{InfinityModifier: pgtype.Infinity, Valid: true}, open
	}
	return timestamptz(after.Key), uuid(after.ID)
}

// notFoundOr maps "no row" to NotFound and wraps anything else.
func notFoundOr(op, what string, err error) error {
	if errors.Is(err, pgx.ErrNoRows) {
		return sharederrors.NotFound(op, what+" not found")
	}
	return sharederrors.Wrap(op, err)
}
