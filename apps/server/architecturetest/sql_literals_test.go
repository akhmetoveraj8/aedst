package architecturetest

import (
	"go/ast"
	"go/parser"
	"go/token"
	"io/fs"
	"path/filepath"
	"strings"
	"testing"
)

// rawSQLAllowed are the only packages that may pass a string literal to
// Exec/Query/QueryRow. Everything else writes SQL in sql/**/*.sql and calls the sqlc
// generated code (gen/db/**).
//   - platform/lock: advisory-lock functions take no table and have no sqlc home.
//   - platform/postgrestest, platform/events/eventstest: test infrastructure
//     (CREATE DATABASE, reading river_job in tests).
var rawSQLAllowed = []string{
	"internal/platform/lock",
	"internal/platform/postgrestest",
	"internal/platform/events/eventstest",
}

// TestNoRawSQLLiterals is the "SQL goes through sqlc" rule. forbidigo cannot look at
// call arguments, so this walks the AST: a call to a method named Exec, Query or
// QueryRow whose first or second argument is a string literal is a violation outside
// rawSQLAllowed (and outside gen/, which is sqlc output).
func TestNoRawSQLLiterals(t *testing.T) {
	checked := 0
	for _, root := range []string{"../internal", "../cmd"} {
		err := filepath.WalkDir(root, func(path string, d fs.DirEntry, err error) error {
			if err != nil {
				return err
			}
			slash := filepath.ToSlash(path)
			if d.IsDir() || !strings.HasSuffix(path, ".go") || strings.HasSuffix(path, "_test.go") || allowedRawSQL(slash) {
				return nil
			}
			fset := token.NewFileSet()
			file, err := parser.ParseFile(fset, path, nil, 0)
			if err != nil {
				return err
			}
			checked++
			for _, pos := range rawSQLCalls(file) {
				t.Errorf("%s: SQL string literal passed to Exec/Query/QueryRow — add the statement to sql/<schema>/*.sql and call the sqlc-generated method", fset.Position(pos))
			}
			return nil
		})
		if err != nil {
			t.Fatal(err)
		}
	}
	if checked < 100 {
		t.Fatalf("only %d files scanned: the walk is broken", checked)
	}
}

// TestRawSQLCheckRejectsLiterals is the negative self-test.
func TestRawSQLCheckRejectsLiterals(t *testing.T) {
	const src = "package x\nfunc f(ctx C, tx T) {\n" +
		"\ttx.Exec(ctx, `UPDATE t SET a = 1`)\n" +
		"\ttx.QueryRow(ctx, \"SELECT 1\").Scan(&n)\n" +
		"\ttx.Query(ctx,\n\t\t`SELECT 2`)\n" +
		"\tq.Exec(ctx, query)\n" + // a variable: out of reach, not a literal
		"\tq.Get(ctx, \"key\")\n" + // not an SQL method
		"}\n"
	file, err := parser.ParseFile(token.NewFileSet(), "x.go", src, 0)
	if err != nil {
		t.Fatal(err)
	}
	if got := rawSQLCalls(file); len(got) != 3 {
		t.Fatalf("found %d literal SQL calls, want 3", len(got))
	}
	if !allowedRawSQL("../internal/platform/lock/lock.go") || allowedRawSQL("../internal/modules/tasks/infrastructure/postgres/postgres.go") {
		t.Fatal("allowlist must cover platform/lock only among these")
	}
}

func allowedRawSQL(slashPath string) bool {
	for _, a := range rawSQLAllowed {
		if strings.Contains(slashPath, a+"/") {
			return true
		}
	}
	return false
}

func rawSQLCalls(file *ast.File) []token.Pos {
	var out []token.Pos
	ast.Inspect(file, func(n ast.Node) bool {
		call, ok := n.(*ast.CallExpr)
		if !ok {
			return true
		}
		sel, ok := call.Fun.(*ast.SelectorExpr)
		if !ok || (sel.Sel.Name != "Exec" && sel.Sel.Name != "Query" && sel.Sel.Name != "QueryRow") {
			return true
		}
		for _, arg := range call.Args[:min(2, len(call.Args))] {
			if lit, ok := arg.(*ast.BasicLit); ok && lit.Kind == token.STRING {
				out = append(out, call.Pos())
				break
			}
		}
		return true
	})
	return out
}
