package architecturetest

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"go/types"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

const (
	// sqlcPackagePart marks the sqlc-generated query packages (gen/db/<module>).
	sqlcPackagePart = "/gen/db/"
	// queryLoopAllow is the escape hatch: a comment on the call's line or the
	// line above it, followed by the reason (a bounded loop, one statement per
	// item by design, a batch that must stop at the first failure).
	queryLoopAllow = "querylint:loop-ok"
)

// TestNoQueryInsideALoop is the cheap N+1 gate (docs/content/engineering/performance.md,
// "Queries"): module code must not call a sqlc query from the body of a for or
// range statement. One statement per item is what `= ANY($1)`, a join, a
// multi-row insert or CopyFrom replace.
//
// It is static and deliberately narrow: it sees a query called directly in a
// loop body (closures included), not one reached through a helper the loop
// calls, and not a loop in a caller of another package. Those stay a review
// item. A loop that is right as it is carries `// querylint:loop-ok <reason>`.
func TestNoQueryInsideALoop(t *testing.T) {
	cfg := &packages.Config{
		Mode: packages.NeedName | packages.NeedImports | packages.NeedDeps |
			packages.NeedTypes | packages.NeedSyntax | packages.NeedTypesInfo | packages.NeedFiles,
	}
	pkgs, err := packages.Load(cfg, "../internal/modules/...")
	if err != nil {
		t.Fatalf("load packages: %v", err)
	}
	if packages.PrintErrors(pkgs) > 0 {
		t.Fatal("packages failed to load cleanly")
	}
	for _, pkg := range pkgs {
		for _, msg := range queryLoopViolations(pkg.Fset, pkg.Syntax, pkg.TypesInfo) {
			t.Error(msg)
		}
	}
}

// queryLoopViolations reports calls to a sqlc query method made inside a loop body.
func queryLoopViolations(fset *token.FileSet, files []*ast.File, info *types.Info) []string {
	var out []string
	for _, file := range files {
		if strings.HasSuffix(fset.Position(file.Pos()).Filename, "_test.go") {
			continue
		}
		allowed := map[int]bool{} // lines carrying the allow comment
		for _, group := range file.Comments {
			for _, c := range group.List {
				if rest, ok := strings.CutPrefix(strings.TrimSpace(strings.TrimPrefix(c.Text, "//")), queryLoopAllow); ok && strings.TrimSpace(rest) != "" {
					allowed[fset.Position(c.Pos()).Line] = true
				}
			}
		}
		var loops []ast.Node // bodies of the enclosing for/range statements
		var visit func(n ast.Node) bool
		visit = func(n ast.Node) bool {
			switch n := n.(type) {
			case *ast.ForStmt:
				walkLoop(n.Body, &loops, visit, n.Init, n.Cond, n.Post)
				return false
			case *ast.RangeStmt:
				walkLoop(n.Body, &loops, visit, n.X)
				return false
			case *ast.CallExpr:
				if len(loops) == 0 {
					return true
				}
				sel, ok := n.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				fn, ok := info.Uses[sel.Sel].(*types.Func)
				if !ok || fn.Pkg() == nil || !strings.Contains(fn.Pkg().Path()+"/", sqlcPackagePart) || fn.Signature().Recv() == nil {
					return true
				}
				line := fset.Position(n.Pos()).Line
				if allowed[line] || allowed[line-1] {
					return true
				}
				out = append(out, fmt.Sprintf("%s: query %s.%s is called inside a loop (N+1): batch it with = ANY($1), a join or a multi-row statement, or mark the line `// %s <reason>`",
					fset.Position(n.Pos()), fn.Pkg().Name(), fn.Name(), queryLoopAllow))
			}
			return true
		}
		ast.Inspect(file, visit)
	}
	return out
}

// walkLoop visits a loop: its header expressions run once (or are cheap), only
// the body counts as "inside".
func walkLoop(body *ast.BlockStmt, loops *[]ast.Node, visit func(ast.Node) bool, header ...ast.Node) {
	for _, h := range header {
		if h != nil {
			ast.Inspect(h, visit)
		}
	}
	*loops = append(*loops, body)
	ast.Inspect(body, visit)
	*loops = (*loops)[:len(*loops)-1]
}

// TestQueryLoopCheckRejectsAQueryInALoop is the negative self-test: a synthetic
// sqlc package and callers that query in a loop, outside one, and with the
// allow comment.
func TestQueryLoopCheckRejectsAQueryInALoop(t *testing.T) {
	fset := token.NewFileSet()
	dbPath := "github.com/aedst/server/gen/db/tasks"
	dbPkg := checkSource(t, fset, dbPath, "tasksdb", nil, `package tasksdb
type Queries struct{}
func New() *Queries { return &Queries{} }
func (q *Queries) GetTask(id string) (string, error) { return id, nil }
func (q *Queries) ListTasksByIDs(ids []string) ([]string, error) { return ids, nil }`)
	deps := map[string]*types.Package{dbPath: dbPkg}

	for name, tc := range map[string]struct {
		body string
		want int
	}{
		"range loop":              {`for _, id := range ids { _, _ = q.GetTask(id) }`, 1},
		"for loop":                {`for i := 0; i < len(ids); i++ { _, _ = q.GetTask(ids[i]) }`, 1},
		"closure inside a loop":   {`for _, id := range ids { func() { _, _ = q.GetTask(id) }() }`, 1},
		"nested loops count once": {`for range ids { for _, id := range ids { _, _ = q.GetTask(id) } }`, 1},
		"batched, no loop":        {`_, _ = q.ListTasksByIDs(ids)`, 0},
		"query in the range header runs once": {`rows, _ := q.ListTasksByIDs(ids)
	for range rows { }
	for _, r := range mustList(q, ids) { _ = r }`, 0},
		"allowed with a reason": {`for _, id := range ids {
		// querylint:loop-ok at most three ids, one statement each keeps the code simple
		_, _ = q.GetTask(id)
	}`, 0},
		"allow comment without a reason does not count": {`for _, id := range ids {
		// querylint:loop-ok
		_, _ = q.GetTask(id)
	}`, 1},
	} {
		src := `package p
import tasksdb "` + dbPath + `"
func mustList(q *tasksdb.Queries, ids []string) []string { out, _ := q.ListTasksByIDs(ids); return out }
func f(q *tasksdb.Queries, ids []string) {
	` + tc.body + `
}`
		file, err := parser.ParseFile(fset, "caller.go", src, parser.ParseComments)
		if err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		info := &types.Info{Uses: map[*ast.Ident]types.Object{}}
		if _, err := (&types.Config{Importer: mapImporter(deps)}).Check(modulePrefix+"tasks/infrastructure/postgres", fset, []*ast.File{file}, info); err != nil {
			t.Fatalf("%s: %v", name, err)
		}
		if got := queryLoopViolations(fset, []*ast.File{file}, info); len(got) != tc.want {
			t.Errorf("%s: %d violations %q, want %d", name, len(got), got, tc.want)
		}
	}
}
