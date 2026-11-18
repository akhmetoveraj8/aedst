package application

import (
	"context"
	"errors"
	"fmt"

	"github.com/aedst/server/internal/modules/admin/domain"
	notificationsapi "github.com/aedst/server/internal/modules/notifications/api"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// Applier performs a pending audit entry's effect through the owning module's
// operator API and resolves the entry. It is what the admin.apply job runs.
type Applier struct {
	audit         AuditStore
	tasks         tasksapi.OperatorService
	notifications notificationsapi.Operator
	clock         sharedtime.Clock
}

// NewApplier builds the Applier. Either owner may be nil when that module is
// hosted in this process (its entries are never pending).
func NewApplier(audit AuditStore, tasks tasksapi.OperatorService, notifications notificationsapi.Operator, clock sharedtime.Clock) *Applier {
	return &Applier{audit: audit, tasks: tasks, notifications: notifications, clock: clock}
}

// Apply runs entry id's effect. It returns nil when the entry is resolved (applied
// or failed for good) or was already resolved, so a redelivered job is a no-op; it
// returns an error when the attempt should be retried. lastAttempt says River will
// not retry again: a still-transient failure then resolves the entry as failed
// instead of leaving it pending forever.
//
// The owner's API is idempotent on the entry id, so retrying after a lost response
// (the effect happened, the resolution did not) never repeats the effect.
func (a *Applier) Apply(ctx context.Context, id ids.ID, lastAttempt bool) error {
	e, err := a.audit.Get(ctx, id)
	if sharederrors.KindOf(err) == sharederrors.KindNotFound {
		return nil // purged or never written: nothing to apply
	}
	if err != nil {
		return err
	}
	if e.State != domain.StatePending {
		return nil
	}

	result, err := a.perform(ctx, e)
	switch {
	case err == nil:
		return a.resolve(ctx, e, domain.StateApplied, "", result)
	case permanent(err):
		return a.resolve(ctx, e, domain.StateFailed, failureText(err), nil)
	case lastAttempt:
		return a.resolve(ctx, e, domain.StateFailed, "gave up after repeated failures: "+failureText(err), nil)
	default:
		return err // transient: River retries with backoff
	}
}

func (a *Applier) perform(ctx context.Context, e domain.AuditEntry) (map[string]any, error) {
	key := e.ID.String()
	switch e.Action {
	case domain.ActionDeleteTask:
		if a.tasks == nil {
			return nil, errNotConfigured("tasks operator")
		}
		taskID, err := ids.Parse(e.TargetID)
		if err != nil {
			return nil, sharederrors.Validation("admin.apply", "audit entry has an invalid task id")
		}
		owner, err := a.tasks.DeleteTask(ctx, key, taskID)
		if err != nil {
			return nil, err
		}
		return map[string]any{"owner_id": owner.String()}, nil
	case domain.ActionBroadcastNotification:
		if a.notifications == nil {
			return nil, errNotConfigured("notifications operator")
		}
		var user *ids.ID
		if e.TargetKind == domain.TargetUser {
			id, err := ids.Parse(e.TargetID)
			if err != nil {
				return nil, sharederrors.Validation("admin.apply", "audit entry has an invalid user id")
			}
			user = &id
		}
		b := notificationsapi.Broadcast{Title: str(e.Metadata, "title"), Body: str(e.Metadata, "body"), Link: str(e.Metadata, "link")}
		n, err := a.notifications.BroadcastIdempotent(ctx, key, user, b)
		if err != nil {
			return nil, err
		}
		return map[string]any{"recipients": n}, nil
	default:
		return nil, sharederrors.Validation("admin.apply", fmt.Sprintf("unknown audited action %q", e.Action))
	}
}

func (a *Applier) resolve(ctx context.Context, e domain.AuditEntry, to domain.State, failure string, result map[string]any) error {
	resolved, err := e.Resolve(to, failure) // the state machine, so a bug cannot skip it
	if err != nil {
		return err
	}
	// false = someone resolved it first (a concurrent delivery): the outcome stands.
	_, err = a.audit.Resolve(ctx, resolved.ID, resolved.State, resolved.Failure, result, a.clock.Now())
	return err
}

// permanent reports whether retrying cannot change the answer. Authentication,
// authorization, rate-limit, timeout and unknown errors are transient on purpose:
// a misconfigured or expiring service identity heals without losing the action.
func permanent(err error) bool {
	switch sharederrors.KindOf(err) {
	case sharederrors.KindNotFound, sharederrors.KindValidation, sharederrors.KindConflict,
		sharederrors.KindAlreadyExists, sharederrors.KindFailedPrecondition:
		return true
	case sharederrors.KindUnknown, sharederrors.KindUnauthorized, sharederrors.KindForbidden,
		sharederrors.KindRateLimited, sharederrors.KindUnavailable, sharederrors.KindTimeout:
		return false
	default:
		return false
	}
}

// failureText is what an operator may read in the audit log: the client-safe
// message of a domain error, never the wrapped cause.
func failureText(err error) string {
	if se, ok := errors.AsType[*sharederrors.Error](err); ok && se.Message != "" {
		return se.Message
	}
	return "internal error"
}

func str(m map[string]any, key string) string {
	s, _ := m[key].(string)
	return s
}
