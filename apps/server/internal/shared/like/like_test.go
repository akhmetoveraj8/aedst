package like_test

import (
	"testing"

	"github.com/aedst/server/internal/shared/like"
)

func TestEscape(t *testing.T) {
	for in, want := range map[string]string{
		"plain":   "plain",
		"50%":     `50\%`,
		"a_b":     `a\_b`,
		`back\sl`: `back\sl`,
		`%_\`:     `\%\_\`,
		"":        "",
	} {
		if got := like.Escape(in); got != want {
			t.Errorf("Escape(%q) = %q, want %q", in, got, want)
		}
	}
}
