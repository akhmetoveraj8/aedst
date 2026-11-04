// Package domain holds the tasks module's entities and invariants. It imports
// nothing outside the standard library and shared primitives — no
// infrastructure, no other module (see docs/content/server/modules.md).
package domain

import (
	"strings"
	"time"
	"unicode/utf8"

	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// Field limits. They mirror the protovalidate constraints on the wire
// (tasks.proto) because the domain, not the transport, is the authority: a
// task created by any other entry point (a job, an import, another module)
// must obey the same rules.
const (
	MaxTitleLength       = 200
	MaxDescriptionLength = 4000
)

type Status string

const (
	StatusTodo       Status = "todo"
	StatusInProgress Status = "in_progress"
	StatusDone       Status = "done"
)

func (s Status) Valid() bool {
	switch s {
	case StatusTodo, StatusInProgress, StatusDone:
		return true
	}
	return false
}

type Priority string

const (
	PriorityLow    Priority = "low"
	PriorityMedium Priority = "medium"
	PriorityHigh   Priority = "high"
	PriorityUrgent Priority = "urgent"
)

func (p Priority) Valid() bool {
	switch p {
	case PriorityLow, PriorityMedium, PriorityHigh, PriorityUrgent:
		return true
	}
	return false
}

// Task is owned entirely by its creator — see
// api/proto/aedst/tasks/v1/tasks.proto's service doc comment for why
// nothing in this module ever takes a user id from a request.
//
// Invariants (enforced by NewTask and Patch.Normalize, never by callers):
// title is non-empty and at most MaxTitleLength characters, description at
// most MaxDescriptionLength, priority is one of the known values, and status
// only moves through Complete/Reopen — never through a plain update.
type Task struct {
	ID          ids.ID
	UserID      ids.ID
	Title       string
	Description string
	Status      Status
	Priority    Priority
	DueDate     *time.Time
	CompletedAt *time.Time
	CreatedAt   time.Time
	UpdatedAt   time.Time
	// Version starts at 1 and increases with every persisted mutation; it is
	// the token for optimistic concurrency (see Patch's caller).
	Version int
}

// NewTask builds a valid todo task, or returns a Validation error naming the
// broken invariant.
func NewTask(id, userID ids.ID, title, description string, priority Priority, dueDate *time.Time, now time.Time) (Task, error) {
	title, err := normalizeTitle(title)
	if err != nil {
		return Task{}, err
	}
	if err := validateDescription(description); err != nil {
		return Task{}, err
	}
	if !priority.Valid() {
		return Task{}, sharederrors.Validation("tasks.NewTask", "priority must be low, medium, high or urgent")
	}
	return Task{
		ID:          id,
		UserID:      userID,
		Title:       title,
		Description: description,
		Status:      StatusTodo,
		Priority:    priority,
		DueDate:     dueDate,
		CreatedAt:   now,
		UpdatedAt:   now,
		Version:     1,
	}, nil
}

func (t Task) IsOverdue(now time.Time) bool {
	return t.Status != StatusDone && t.DueDate != nil && t.DueDate.Before(now)
}

// NeedsReminder reports whether a due-date reminder should be scheduled: the
// task is still open and its due date is in the future.
func (t Task) NeedsReminder(now time.Time) bool {
	return t.Status != StatusDone && t.DueDate != nil && t.DueDate.After(now)
}

// Patch is a partial update of the user-editable fields. A nil pointer means
// "leave unchanged"; DueDate needs the explicit SetDueDate flag because nil is
// also the way to clear it.
type Patch struct {
	Title       *string
	Description *string
	Priority    *Priority
	SetDueDate  bool
	DueDate     *time.Time
}

// IsEmpty reports whether the patch changes nothing.
func (p Patch) IsEmpty() bool {
	return p.Title == nil && p.Description == nil && p.Priority == nil && !p.SetDueDate
}

// Normalize validates the fields being changed and trims the title, so the
// repository can store the patch as-is.
func (p *Patch) Normalize() error {
	if p.Title != nil {
		title, err := normalizeTitle(*p.Title)
		if err != nil {
			return err
		}
		p.Title = &title
	}
	if p.Description != nil {
		if err := validateDescription(*p.Description); err != nil {
			return err
		}
	}
	if p.Priority != nil && !p.Priority.Valid() {
		return sharederrors.Validation("tasks.Patch", "priority must be low, medium, high or urgent")
	}
	return nil
}

func normalizeTitle(title string) (string, error) {
	title = strings.TrimSpace(title)
	if title == "" {
		return "", sharederrors.Validation("tasks.title", "title must not be empty")
	}
	if utf8.RuneCountInString(title) > MaxTitleLength {
		return "", sharederrors.Validation("tasks.title", "title is too long")
	}
	return title, nil
}

func validateDescription(description string) error {
	if utf8.RuneCountInString(description) > MaxDescriptionLength {
		return sharederrors.Validation("tasks.description", "description is too long")
	}
	return nil
}
