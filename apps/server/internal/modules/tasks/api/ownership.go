package api

import (
	"context"

	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// Ownership is the narrow contract other units use to ask "does this task belong
// to this user?". It is the unit's network-safe surface: plain values in, plain
// values out, no transaction or domain type crosses it. A unit that needs only
// this (media) depends on Ownership and not on Service, so the same code runs
// whether tasks is hosted in this process (NewOwnership) or reached over
// Connect (the Remote hook in tasks/module). Both are held to one contract
// suite, ownershiptest.Run.
type Ownership interface {
	// OwnsTask reports whether taskID exists and belongs to owner. A task that
	// does not exist and a task that belongs to someone else are both (false, nil):
	// the caller must not learn which. An error means the question could not be
	// answered (the unit is down, the caller may not ask).
	OwnsTask(ctx context.Context, owner, taskID ids.ID) (bool, error)
}

// NewOwnership answers Ownership from a Service hosted in this process.
func NewOwnership(s Service) Ownership { return localOwnership{s} }

type localOwnership struct{ tasks Service }

func (o localOwnership) OwnsTask(ctx context.Context, owner, taskID ids.ID) (bool, error) {
	_, err := o.tasks.GetTask(ctx, owner, taskID)
	if sharederrors.KindOf(err) == sharederrors.KindNotFound {
		return false, nil
	}
	if err != nil {
		return false, err //nolint:wrapcheck // the contract passes the owner's classified error through unchanged
	}
	return true, nil
}
