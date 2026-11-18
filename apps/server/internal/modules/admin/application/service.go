// Package application composes the other modules' api/ packages into the
// operator use cases. Every mutation runs inside one transaction together
// with its audit entry (Tx.Run), passing that transaction to the target
// module's *Tx api method.
package application

import (
	"context"
	"time"

	"github.com/jackc/pgx/v5"

	"github.com/aedst/server/internal/modules/admin/domain"
	mediaapi "github.com/aedst/server/internal/modules/media/api"
	notificationsapi "github.com/aedst/server/internal/modules/notifications/api"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// AuditStore persists the audit log.
type AuditStore interface {
	InsertTx(ctx context.Context, tx pgx.Tx, e domain.AuditEntry) error
	// InsertPendingTx writes an entry in state pending (the audit-first path).
	InsertPendingTx(ctx context.Context, tx pgx.Tx, e domain.AuditEntry) error
	// Get reads one entry with its state; NotFound when it does not exist.
	Get(ctx context.Context, id ids.ID) (domain.AuditEntry, error)
	// Resolve moves a pending entry to applied or failed, once, and records the
	// outcome. It reports false when the entry was no longer pending.
	Resolve(ctx context.Context, id ids.ID, state domain.State, failure string, result map[string]any, at time.Time) (bool, error)
	List(ctx context.Context, limit int, after *pagination.Cursor) ([]domain.AuditEntry, *pagination.Cursor, error)
}

// Tx runs fn in one database transaction.
type Tx interface {
	Run(ctx context.Context, fn func(ctx context.Context, tx pgx.Tx) error) error
}

// PlatformStats reports the async pipeline's health.
type PlatformStats interface {
	JobLag(ctx context.Context) (time.Duration, error)
	PendingJobs(ctx context.Context) (int64, error)
}

// AuditSortToken / UserSortToken / TaskSortToken bind page tokens.
const AuditSortToken = "admin:audit:created_at:desc" //nolint:gosec // G101 false positive: a pagination sort-token name, not a credential

// Deps are the composed modules. Media may be nil (storage not configured).
type Deps struct {
	Tasks         tasksapi.AdminService
	Notifications notificationsapi.Broadcaster
	// TasksOps and NotificationsOps are set only when that module is NOT hosted in
	// this process: they are its network clients and switch the matching mutation to
	// the audit-first path (Queue is then required). Nil keeps the in-process
	// transactional path (the *Tx methods of Tasks / Notifications).
	TasksOps         tasksapi.OperatorService
	NotificationsOps notificationsapi.Operator
	Queue            ApplyQueue
	Media            mediaapi.Stats
	Platform         PlatformStats
	Audit            AuditStore
	Tx               Tx
	Clock            sharedtime.Clock
}

type Service struct{ d Deps }

func NewService(d Deps) *Service { return &Service{d: d} }

// Overview aggregates counts from every module.
type Overview struct {
	TasksTotal    int64
	TasksDone     int64
	TasksOverdue  int64
	MediaTotal    int64
	MediaBytes    int64
	PushDevices   int64
	JobLagSeconds int64
	JobsPending   int64
}

func (s *Service) GetOverview(ctx context.Context) (Overview, error) {
	var o Overview
	ts, err := s.d.Tasks.Stats(ctx)
	if err != nil {
		return Overview{}, err
	}
	o.TasksTotal, o.TasksDone, o.TasksOverdue = ts.Total, ts.Done, ts.Overdue
	if s.d.Media != nil {
		if o.MediaTotal, o.MediaBytes, err = s.d.Media.Totals(ctx); err != nil {
			return Overview{}, err
		}
	}
	if o.PushDevices, err = s.d.Notifications.CountActiveDevices(ctx); err != nil {
		return Overview{}, err
	}
	lag, err := s.d.Platform.JobLag(ctx)
	if err != nil {
		return Overview{}, err
	}
	o.JobLagSeconds = int64(lag.Seconds())
	if o.JobsPending, err = s.d.Platform.PendingJobs(ctx); err != nil {
		return Overview{}, err
	}
	return o, nil
}

func (s *Service) ListTasks(ctx context.Context, ownerID *ids.ID, query string, pageSize int32, token string) (tasksapi.ListResult, error) {
	after, err := pagination.Decode(token, tasksapi.AdminSortToken)
	if err != nil {
		return tasksapi.ListResult{}, sharederrors.Validation("admin.ListTasks", "invalid page token")
	}
	return s.d.Tasks.ListAllTasks(ctx, ownerID, query, pageSize, after)
}

// DeleteTask deletes any user's task and records why, atomically.
func (s *Service) DeleteTask(ctx context.Context, actor domain.Actor, taskID ids.ID, reason string) error {
	reason, err := domain.NormalizeReason(reason)
	if err != nil {
		return err
	}
	if s.d.TasksOps != nil {
		return s.deleteTaskAuditFirst(ctx, actor, taskID, reason)
	}
	return s.d.Tx.Run(ctx, func(ctx context.Context, tx pgx.Tx) error {
		owner, err := s.d.Tasks.DeleteTaskTx(ctx, tx, taskID)
		if err != nil {
			return err
		}
		return s.d.Audit.InsertTx(ctx, tx, domain.AuditEntry{
			ID: ids.New(), Actor: actor, Action: domain.ActionDeleteTask,
			TargetKind: domain.TargetTask, TargetID: taskID.String(), Reason: reason,
			Metadata: map[string]any{"owner_id": owner.String()}, CreatedAt: s.d.Clock.Now(),
		})
	})
}

// BroadcastNotification sends a SYSTEM notification through the
// notifications module and audits it, atomically. userID nil = everyone.
func (s *Service) BroadcastNotification(ctx context.Context, actor domain.Actor, userID *ids.ID, title, body, link string) (int64, error) {
	if s.d.NotificationsOps != nil {
		return 0, s.broadcastAuditFirst(ctx, actor, userID, notificationsapi.Broadcast{Title: title, Body: body, Link: link})
	}
	var recipients int64
	err := s.d.Tx.Run(ctx, func(ctx context.Context, tx pgx.Tx) error {
		n, err := s.d.Notifications.BroadcastTx(ctx, tx, userID, notificationsapi.Broadcast{Title: title, Body: body, Link: link})
		if err != nil {
			return err
		}
		recipients = n
		target, targetID := domain.TargetAll, ""
		if userID != nil {
			target, targetID = domain.TargetUser, userID.String()
		}
		return s.d.Audit.InsertTx(ctx, tx, domain.AuditEntry{
			ID: ids.New(), Actor: actor, Action: domain.ActionBroadcastNotification,
			TargetKind: target, TargetID: targetID,
			Metadata:  map[string]any{"title": title, "recipients": n},
			CreatedAt: s.d.Clock.Now(),
		})
	})
	if err != nil {
		return 0, err
	}
	return recipients, nil
}

func (s *Service) ListAuditLog(ctx context.Context, pageSize int32, token string) ([]domain.AuditEntry, *pagination.Cursor, error) {
	after, err := pagination.Decode(token, AuditSortToken)
	if err != nil {
		return nil, nil, sharederrors.Validation("admin.ListAuditLog", "invalid page token")
	}
	return s.d.Audit.List(ctx, int(pagination.ClampLimit(pageSize)), after)
}
