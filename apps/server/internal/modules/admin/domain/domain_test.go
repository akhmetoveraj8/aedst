package domain_test

import (
	"strings"
	"testing"

	"github.com/aedst/server/internal/modules/admin/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
)

func TestNormalizeReason(t *testing.T) {
	got, err := domain.NormalizeReason("  spam account  ")
	if err != nil || got != "spam account" {
		t.Fatalf("got %q, %v", got, err)
	}
	for name, reason := range map[string]string{
		"empty":     "",
		"too short": " ab ",
		"too long":  strings.Repeat("é", domain.MaxReasonLength+1),
	} {
		if _, err := domain.NormalizeReason(reason); sharederrors.KindOf(err) != sharederrors.KindValidation {
			t.Errorf("%s: kind = %v, want validation", name, sharederrors.KindOf(err))
		}
	}
	for _, ok := range []string{"abc", strings.Repeat("é", domain.MaxReasonLength)} {
		if _, err := domain.NormalizeReason(ok); err != nil {
			t.Errorf("%d-char reason must pass: %v", len([]rune(ok)), err)
		}
	}
}

func TestState_OnlyPendingResolvesOnce(t *testing.T) {
	all := []domain.State{domain.StatePending, domain.StateApplied, domain.StateFailed}
	for _, from := range all {
		for _, to := range all {
			want := from == domain.StatePending && to != domain.StatePending
			if got := from.CanTransitionTo(to); got != want {
				t.Errorf("%s -> %s = %v, want %v", from, to, got, want)
			}
		}
	}
}

func TestAuditEntry_Resolve(t *testing.T) {
	pending := domain.AuditEntry{State: domain.StatePending}

	applied, err := pending.Resolve(domain.StateApplied, "ignored")
	if err != nil || applied.State != domain.StateApplied || applied.Failure != "" {
		t.Fatalf("Resolve(applied) = %+v, %v", applied, err)
	}
	failed, err := pending.Resolve(domain.StateFailed, "task not found")
	if err != nil || failed.State != domain.StateFailed || failed.Failure != "task not found" {
		t.Fatalf("Resolve(failed) = %+v, %v", failed, err)
	}
	if _, err := pending.Resolve(domain.StateFailed, "  "); err == nil {
		t.Error("a failed entry without a reason was accepted")
	}
	if _, err := applied.Resolve(domain.StateFailed, "late"); err == nil {
		t.Error("an applied entry was resolved again")
	}
	if _, err := (domain.AuditEntry{}).Resolve(domain.StateApplied, ""); err == nil {
		t.Error("an entry that was never pending was resolved")
	}
}
