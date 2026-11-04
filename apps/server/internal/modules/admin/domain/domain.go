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
