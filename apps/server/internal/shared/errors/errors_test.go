package errors_test

import (
	stderrors "errors"
	"fmt"
	"testing"

	sharederrors "github.com/aedst/server/internal/shared/errors"
)

func TestKindOf_ClassifiesConstructorsAndWalksWrapChains(t *testing.T) {
	tests := []struct {
		name string
		err  error
		want sharederrors.Kind
	}{
		{"not found", sharederrors.NotFound("op", "m"), sharederrors.KindNotFound},
		{"already exists", sharederrors.AlreadyExists("op", "m"), sharederrors.KindAlreadyExists},
		{"conflict", sharederrors.Conflict("op", "m"), sharederrors.KindConflict},
		{"validation", sharederrors.Validation("op", "m"), sharederrors.KindValidation},
		{"unauthorized", sharederrors.Unauthorized("op", "m"), sharederrors.KindUnauthorized},
		{"forbidden", sharederrors.Forbidden("op", "m"), sharederrors.KindForbidden},
		{"rate limited", sharederrors.RateLimited("op", "m"), sharederrors.KindRateLimited},
		{"infrastructure error", sharederrors.Wrap("op", stderrors.New("pq: boom")), sharederrors.KindUnknown},
		{"plain error", stderrors.New("x"), sharederrors.KindUnknown},
		{"wrapped domain error keeps its kind", fmt.Errorf("layer: %w", sharederrors.NotFound("op", "m")), sharederrors.KindNotFound},
		{"nil", nil, sharederrors.KindUnknown},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			if got := sharederrors.KindOf(tt.err); got != tt.want {
				t.Fatalf("KindOf = %v, want %v", got, tt.want)
			}
		})
	}
}

func TestWrap_KeepsTheCauseOutOfTheClientMessage(t *testing.T) {
	cause := stderrors.New("connection refused")
	err := sharederrors.Wrap("tasks.Create", cause)
	if err.Message != "internal error" {
		t.Errorf("Message = %q, want the generic message", err.Message)
	}
	if !stderrors.Is(err, cause) {
		t.Error("the cause must stay reachable for logs")
	}
	if got := err.Error(); got != "tasks.Create: internal error: connection refused" {
		t.Errorf("Error() = %q", got)
	}
	if got := sharederrors.NotFound("tasks.Get", "task not found").Error(); got != "tasks.Get: task not found" {
		t.Errorf("Error() = %q", got)
	}
}
