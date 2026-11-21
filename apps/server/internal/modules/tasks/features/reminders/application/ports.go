// Package application holds the port of the tasks module's reminders feature:
// telling the rest of the system, once, that a task is due soon. The River job
// that drives it lives in infrastructure/jobs, the guarded write in
// infrastructure/postgres.
package application

import (
	"context"
	"time"

	"github.com/aedst/server/internal/shared/ids"
)

// DueSoonMarker publishes tasks.v1.TaskDueSoon at most once per (task, due
// date), guarded in SQL; it reports whether it published. Satisfied by the
// postgres repository (on the jobs pool).
type DueSoonMarker interface {
	MarkDueSoon(ctx context.Context, id, userID ids.ID, dueDate time.Time) (bool, error)
}
