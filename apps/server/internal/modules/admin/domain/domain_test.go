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
