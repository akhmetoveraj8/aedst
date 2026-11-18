// Package domain holds the admin module's own model: the audit entry. Every
// other admin concept belongs to the module it administers.
package domain

import (
	"strings"
	"time"
	"unicode/utf8"

	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// Audited actions.
const (
	ActionDeleteTask            = "task.delete"
	ActionBroadcastNotification = "notification.broadcast"
)

// Target kinds.
const (
	TargetTask = "task"
	TargetUser = "user"
	TargetAll  = "all_users"
)

// Actor is the operator performing an action.
type Actor struct {
	UserID  ids.ID
	Subject string
	Issuer  string
}

// State is where an audit entry stands. An action done in the same transaction as
// its entry (the in-process path) is Applied from the start. An audit-first action
// (the owning module runs in another process) starts Pending and is resolved once
// by the admin.apply job.
type State string

const (
	StatePending State = "pending"
	StateApplied State = "applied"
	StateFailed  State = "failed"
)

// CanTransitionTo is the whole state machine: a pending entry resolves to applied
// or failed, once. Nothing else moves (the database trigger enforces the same).
func (s State) CanTransitionTo(to State) bool {
	return s == StatePending && (to == StateApplied || to == StateFailed)
}

// AuditEntry records one operator action.
type AuditEntry struct {
	ID         ids.ID
	Actor      Actor
	Action     string
	TargetKind string
	TargetID   string
	Reason     string
	Metadata   map[string]any
	CreatedAt  time.Time
	// State is empty for an entry that has not been read back from the store;
	// treat empty as StateApplied (the default of the in-process path).
	State State
	// Failure is the client-safe reason of a StateFailed entry.
	Failure string
}

// Resolve returns the entry in its final state. It refuses any move that is not
// pending -> applied|failed, and a failed entry must say why.
func (e AuditEntry) Resolve(to State, failure string) (AuditEntry, error) {
	if !e.State.CanTransitionTo(to) {
		return e, sharederrors.FailedPrecondition("admin.audit", "audit entry is "+string(e.State)+", it cannot become "+string(to))
	}
	if to == StateFailed && strings.TrimSpace(failure) == "" {
		return e, sharederrors.Validation("admin.audit", "a failed audit entry needs a reason")
	}
	e.State, e.Failure = to, failure
	if to == StateApplied {
		e.Failure = ""
	}
	return e, nil
}

const (
	MinReasonLength = 3
	MaxReasonLength = 500
)

// NormalizeReason validates a mandatory justification (admin.proto).
func NormalizeReason(reason string) (string, error) {
	reason = strings.TrimSpace(reason)
	n := utf8.RuneCountInString(reason)
	if n < MinReasonLength || n > MaxReasonLength {
		return "", sharederrors.Validation("admin.reason", "reason must be 3-500 characters")
	}
	return reason, nil
}
