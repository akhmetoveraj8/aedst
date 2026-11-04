package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/tasks/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

var now = time.Date(2026, 1, 1, 12, 0, 0, 0, time.UTC)

func TestNewTask(t *testing.T) {
	tests := []struct {
		name     string
		title    string
		desc     string
		priority domain.Priority
		wantErr  bool
	}{
		{"valid", "  buy milk ", "", domain.PriorityLow, false},
		{"blank title", "   ", "", domain.PriorityLow, true},
		{"title counts characters not bytes", strings.Repeat("é", domain.MaxTitleLength), "", domain.PriorityLow, false},
		{"title too long", strings.Repeat("é", domain.MaxTitleLength+1), "", domain.PriorityLow, true},
		{"description too long", "x", strings.Repeat("d", domain.MaxDescriptionLength+1), domain.PriorityLow, true},
		{"unknown priority", "x", "", domain.Priority("nope"), true},
		{"unspecified priority", "x", "", domain.Priority(""), true},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			task, err := domain.NewTask(ids.New(), ids.New(), tt.title, tt.desc, tt.priority, nil, now)
			if tt.wantErr {
				if sharederrors.KindOf(err) != sharederrors.KindValidation {
					t.Fatalf("err = %v, want a Validation error", err)
				}
				return
			}
			if err != nil {
				t.Fatalf("NewTask: %v", err)
			}
			if task.Status != domain.StatusTodo || task.Version != 1 || task.Title != strings.TrimSpace(tt.title) {
				t.Fatalf("unexpected task %+v", task)
			}
		})
	}
}

func TestPatch_Normalize(t *testing.T) {
	blank, trimmed, bad := "  ", "  new  ", domain.Priority("x")
	if err := (&domain.Patch{Title: &blank}).Normalize(); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("blank title: %v", err)
	}
	if err := (&domain.Patch{Priority: &bad}).Normalize(); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("bad priority: %v", err)
	}
	p := domain.Patch{Title: &trimmed}
	if err := p.Normalize(); err != nil || *p.Title != "new" {
		t.Errorf("Normalize() = %v, title %q; want trimmed", err, *p.Title)
	}
	if !(domain.Patch{}).IsEmpty() || (domain.Patch{SetDueDate: true}).IsEmpty() {
		t.Error("IsEmpty misreports")
	}
}

func TestTask_NeedsReminderAndOverdue(t *testing.T) {
	future, past := now.Add(time.Hour), now.Add(-time.Hour)
	tests := []struct {
		name        string
		task        domain.Task
		remind, due bool
	}{
		{"open, future due", domain.Task{Status: domain.StatusTodo, DueDate: &future}, true, false},
		{"open, past due", domain.Task{Status: domain.StatusTodo, DueDate: &past}, false, true},
		{"done, future due", domain.Task{Status: domain.StatusDone, DueDate: &future}, false, false},
		{"no due date", domain.Task{Status: domain.StatusTodo}, false, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := tt.task.NeedsReminder(now); got != tt.remind {
				t.Errorf("NeedsReminder = %v, want %v", got, tt.remind)
			}
			if got := tt.task.IsOverdue(now); got != tt.due {
				t.Errorf("IsOverdue = %v, want %v", got, tt.due)
			}
		})
	}
}
