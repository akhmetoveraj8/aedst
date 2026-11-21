package architecturetest

import (
	"fmt"
	"io/fs"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// selectStar matches `SELECT *`, `SELECT t.*` and `RETURNING *`. `count(*)` does
// not match: the star must directly follow the keyword (or a table qualifier).
var selectStar = regexp.MustCompile(`(?i)\b(SELECT|RETURNING)\s+(\w+\.)?\*`)

// TestQueriesNameTheirColumns enforces "fetch only required columns"
// (docs/content/engineering/performance.md): a star ships every column to the
// caller and changes the result shape silently when a migration adds one.
// `sqlc vet` cannot gate this because sqlc expands the star before its rules run.
func TestQueriesNameTheirColumns(t *testing.T) {
	err := filepath.WalkDir("../sql", func(path string, d fs.DirEntry, err error) error {
		if err != nil || d.IsDir() || filepath.Ext(path) != ".sql" {
			return err
		}
		src, err := os.ReadFile(path)
		if err != nil {
			return err
		}
		for _, msg := range selectStarViolations(filepath.ToSlash(path), string(src)) {
			t.Error(msg)
		}
		return nil
	})
	if err != nil {
		t.Fatalf("walk sql: %v", err)
	}
}

// selectStarViolations reports each line of a query file that selects or returns
// a star. SQL line comments are ignored.
func selectStarViolations(path, src string) []string {
	var out []string
	for i, line := range strings.Split(src, "\n") {
		code, _, _ := strings.Cut(line, "--")
		if selectStar.MatchString(code) {
			out = append(out, fmt.Sprintf("%s:%d: name the columns instead of a star: %s", path, i+1, strings.TrimSpace(code)))
		}
	}
	return out
}

func TestSelectStarViolationsSelfTest(t *testing.T) {
	bad := "-- name: A :many\nSELECT * FROM t;\n-- name: B :one\nUPDATE t SET x = 1 WHERE id = $1\nRETURNING *;\n-- name: C :many\nselect m.* from t m;\n"
	if got := selectStarViolations("bad.sql", bad); len(got) != 3 {
		t.Fatalf("want 3 violations, got %d: %v", len(got), got)
	}
	good := "-- SELECT * is banned\nSELECT count(*) AS total, id FROM t GROUP BY id;\nSELECT a * b AS product FROM t;\nDELETE FROM t WHERE id = $1 RETURNING id;\n"
	if got := selectStarViolations("good.sql", good); len(got) != 0 {
		t.Fatalf("want no violations, got %v", got)
	}
}
