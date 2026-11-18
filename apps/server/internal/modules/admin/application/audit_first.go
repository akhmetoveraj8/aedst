package application

import (
	"context"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/admin/domain"
	notificationsapi "github.com/aedst/server/internal/modules/notifications/api"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// The audit-first path (docs/content/decisions/0020-location-transparent-units.md).
//
// When the module that owns the target is not hosted in this process, admin cannot
// pass it a transaction. It writes the audit entry first, in state pending, and the
// admin.apply job in the SAME transaction; the job performs the effect through the
// owner's network-safe operator API (idempotent on the audit entry id) and resolves
// the entry. So there is never an effect without an entry, and an entry that
// stays pending or turns failed says honestly that the effect did not happen.
// The in-process path (Service.DeleteTask / BroadcastNotification with local
// modules) is unchanged and keeps its single-transaction guarantee.

// ApplyQueue enqueues the admin.apply job for an audit entry inside tx.
type ApplyQueue interface {
	EnqueueApplyTx(ctx context.Context, tx pgx.Tx, auditID ids.ID) error
}

// available is implemented by a remote operator client that may be unable to act
// (no service identity is configured): checked before any pending entry is written,
// so an action that could never be applied is refused instead of queued.
type available interface{ Available() error }

func checkAvailable(target any) error {
	if a, ok := target.(available); ok {
		return a.Available()
	}
	return nil
}

func (s *Service) deleteTaskAuditFirst(ctx context.Context, actor domain.Actor, taskID ids.ID, reason string) error {
	if err := checkAvailable(s.d.TasksOps); err != nil {
		return err
	}
	return s.d.Tx.Run(ctx, func(ctx context.Context, tx pgx.Tx) error {
		entry := domain.AuditEntry{
			ID: ids.New(), Actor: actor, Action: domain.ActionDeleteTask,
			TargetKind: domain.TargetTask, TargetID: taskID.String(), Reason: reason,
			Metadata: map[string]any{}, CreatedAt: s.d.Clock.Now(),
		}
		if err := s.d.Audit.InsertPendingTx(ctx, tx, entry); err != nil {
			return err
		}
		return s.d.Queue.EnqueueApplyTx(ctx, tx, entry.ID)
	})
}

// broadcastAuditFirst queues the broadcast. The recipient count is not known until
// the job has run, so the caller reports 0 (the count lands in the entry's result).
func (s *Service) broadcastAuditFirst(ctx context.Context, actor domain.Actor, userID *ids.ID, b notificationsapi.Broadcast) error {
	if err := checkAvailable(s.d.NotificationsOps); err != nil {
		return err
	}
	// Validate now so a message the owner would refuse is never queued. Validate
	// normalizes in place; the normalized text is what is stored and later sent.
	if err := b.Validate(); err != nil {
		return err
	}
	target, targetID := domain.TargetAll, ""
	if userID != nil {
		target, targetID = domain.TargetUser, userID.String()
	}
	return s.d.Tx.Run(ctx, func(ctx context.Context, tx pgx.Tx) error {
		entry := domain.AuditEntry{
			ID: ids.New(), Actor: actor, Action: domain.ActionBroadcastNotification,
			TargetKind: target, TargetID: targetID,
			Metadata:  map[string]any{"title": b.Title, "body": b.Body, "link": b.Link},
			CreatedAt: s.d.Clock.Now(),
		}
		if err := s.d.Audit.InsertPendingTx(ctx, tx, entry); err != nil {
			return err
		}
		return s.d.Queue.EnqueueApplyTx(ctx, tx, entry.ID)
	})
}

func errNotConfigured(what string) error {
	return sharederrors.FailedPrecondition("admin.apply", what+" is not available in this process")
}
