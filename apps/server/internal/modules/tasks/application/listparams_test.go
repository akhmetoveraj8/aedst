package application_test

import (
	"testing"

	"github.com/aedst/server/internal/modules/tasks/application"
	"github.com/aedst/server/internal/modules/tasks/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
)

func TestListParamsNormalize(t *testing.T) {
	p := application.ListParams{}
	if err := p.Normalize(); err != nil || p.SortBy != "created_at" || p.SortDirection != "desc" || p.Limit == 0 {
		t.Fatalf("defaults: %+v, %v", p, err)
	}
	big := application.ListParams{Limit: 1_000_000}
	if err := big.Normalize(); err != nil || big.Limit > 100 {
		t.Fatalf("an oversized page is clamped, not rejected: %+v, %v", big, err)
	}
	for name, p := range map[string]application.ListParams{
		"sort field":     {SortBy: "title; DROP TABLE"},
		"sort direction": {SortDirection: "sideways"},
		"status":         {Statuses: []domain.Status{"archived"}},
		"priority":       {Priorities: []domain.Priority{"whenever"}},
	} {
		err := p.Normalize()
		if sharederrors.KindOf(err) != sharederrors.KindValidation {
			t.Errorf("%s: Normalize() = %v, want a Validation error", name, err)
		}
	}
}
