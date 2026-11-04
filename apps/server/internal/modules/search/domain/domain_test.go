package domain_test

import (
	"strings"
	"testing"

	"github.com/aedst/server/internal/modules/search/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

func TestNormalizeQuery(t *testing.T) {
	got, err := domain.NormalizeQuery("  milk  ")
	if err != nil || got != "milk" {
		t.Fatalf("NormalizeQuery trims: got %q, %v", got, err)
	}
	for name, q := range map[string]string{
		"empty":    "",
		"blank":    "   \t",
		"too long": strings.Repeat("é", domain.MaxQueryLength+1),
	} {
		if _, err := domain.NormalizeQuery(q); sharederrors.KindOf(err) != sharederrors.KindValidation {
			t.Errorf("%s: kind = %v, want validation (err=%v)", name, sharederrors.KindOf(err), err)
		}
	}
	if _, err := domain.NormalizeQuery(strings.Repeat("é", domain.MaxQueryLength)); err != nil {
		t.Errorf("a query of MaxQueryLength characters (not bytes) must pass: %v", err)
	}
}

func TestCursorRoundTrip(t *testing.T) {
	id := ids.New()
	token := domain.Cursor{Query: "milk", Score: 0.123456789, ID: id}.Encode()
	got, err := domain.DecodeCursor(token, "milk")
	if err != nil || got == nil {
		t.Fatalf("DecodeCursor: %v, %v", got, err)
	}
	if got.ID != id || got.Score != 0.123456789 || got.Query != "milk" {
		t.Fatalf("round trip mismatch: %+v", got)
	}
	if first, err := domain.DecodeCursor("", "milk"); first != nil || err != nil {
		t.Fatalf("empty token is the first page: %v, %v", first, err)
	}
}

func TestDecodeCursorRejects(t *testing.T) {
	token := domain.Cursor{Query: "milk", Score: 1, ID: ids.New()}.Encode()
	for name, tc := range map[string]struct{ token, query string }{
		"other query": {token, "bread"},
		"not base64":  {"!!!", "milk"},
		"garbage":     {"aGVsbG8", "milk"},
	} {
		if c, err := domain.DecodeCursor(tc.token, tc.query); err == nil {
			t.Errorf("%s: want error, got cursor %+v", name, c)
		}
	}
}

func TestClampPageSize(t *testing.T) {
	for _, tc := range []struct{ n, want int }{{0, 20}, {-5, 20}, {7, 7}, {50, 50}, {51, 50}, {1000, 50}} {
		if got := domain.ClampPageSize(tc.n, domain.DefaultPageSize, domain.MaxPageSize); got != tc.want {
			t.Errorf("ClampPageSize(%d) = %d, want %d", tc.n, got, tc.want)
		}
	}
}

func TestTruncateBody(t *testing.T) {
	short := "hello"
	if domain.TruncateBody(short) != short {
		t.Error("short body must be unchanged")
	}
	long := strings.Repeat("é", domain.MaxBodyLength+10)
	if got := []rune(domain.TruncateBody(long)); len(got) != domain.MaxBodyLength {
		t.Errorf("truncated to %d runes, want %d", len(got), domain.MaxBodyLength)
	}
}
