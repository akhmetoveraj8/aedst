package goldentest_test

import (
	"os"
	"path/filepath"
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/platform/events/goldentest"
)

type payloadV1 struct {
	ID string    `json:"id"`
	At time.Time `json:"at"`
}

func write(t *testing.T, dir, name, body string) {
	t.Helper()
	if err := os.WriteFile(filepath.Join(dir, name), []byte(body), 0o600); err != nil {
		t.Fatal(err)
	}
}

// The negative self-test: each way of breaking an event contract is reported.
func TestProblems(t *testing.T) {
	cases := func(version int) []goldentest.Case {
		return []goldentest.Case{{Type: "x.v1.Thing", Version: version, New: func() any { return new(payloadV1) }}}
	}
	const good = "{\n  \"id\": \"a\",\n  \"at\": \"2026-01-01T00:00:00Z\"\n}\n"

	tests := []struct {
		name    string
		files   map[string]string
		version int
		want    string // substring of the first problem; empty = clean
	}{
		{"conforming", map[string]string{"Thing.v1.json": good}, 1, ""},
		{"missing fixture for a bumped version", map[string]string{"Thing.v1.json": good}, 2, "missing fixture Thing.v2.json"},
		{"renamed or removed field", map[string]string{"Thing.v1.json": "{\"identifier\": \"a\"}"}, 1, "unknown field"},
		{"added field not in the fixture", map[string]string{"Thing.v1.json": "{\"id\": \"a\"}"}, 1, "differs after decode"},
		{"orphan fixture", map[string]string{"Thing.v1.json": good, "Other.v1.json": good}, 1, "no event Other"},
		{"fixture above the published version", map[string]string{"Thing.v1.json": good, "Thing.v2.json": good}, 1, "above the published"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			dir := t.TempDir()
			for name, body := range tc.files {
				write(t, dir, name, body)
			}
			got := goldentest.Problems(dir, cases(tc.version))
			switch {
			case tc.want == "" && len(got) != 0:
				t.Fatalf("want clean, got %q", got)
			case tc.want != "" && (len(got) == 0 || !strings.Contains(strings.Join(got, "\n"), tc.want)):
				t.Fatalf("want a problem containing %q, got %q", tc.want, got)
			}
		})
	}
}
