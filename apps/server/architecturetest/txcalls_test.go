package architecturetest

import (
	"fmt"
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

const adminModule = "admin"

// TestOnlyAdminCallsTxAPIMethods enforces the one sanctioned cross-module
// transaction: the admin module opens a pgx.Tx and passes it to another module's
// *Tx api method (apps/server/AGENTS.md, "Operator (admin) mutations"). Any other
// module calling such a method would make a transaction span modules.
func TestOnlyAdminCallsTxAPIMethods(t *testing.T) {
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
		for _, msg := range txCallViolations(pkg.PkgPath, pkg.Fset, pkg.Syntax, pkg.TypesInfo) {
			t.Error(msg)
		}
	}
}

// txCallViolations reports calls in pkgPath (a package of a non-admin module) to a
// method whose name ends in Tx and that is declared in ANOTHER module's api package.
func txCallViolations(pkgPath string, fset *token.FileSet, files []*ast.File, info *types.Info) []string {
	caller := moduleOf(pkgPath)
	if caller == "" || caller == adminModule {
		return nil
	}
	var out []string
	for _, file := range files {
		if strings.HasSuffix(fset.Position(file.Pos()).Filename, "_test.go") {
			continue
		}
		ast.Inspect(file, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || !strings.HasSuffix(sel.Sel.Name, "Tx") {
				return true
			}
			fn, ok := info.Uses[sel.Sel].(*types.Func)
			if !ok || fn.Pkg() == nil {
				return true
			}
			owner := moduleOf(fn.Pkg().Path())
			if owner != "" && owner != caller && layerOf(fn.Pkg().Path(), owner) == "api" {
				out = append(out, fmt.Sprintf("%s: module %q calls %s.%s of module %q — only the admin module may call *Tx api methods",
					fset.Position(call.Pos()), caller, fn.Pkg().Name(), fn.Name(), owner))
			}
			return true
		})
	}
	return out
}

// TestTxCallCheckRejectsNonAdminCaller is the negative self-test: type-checks a
// synthetic tasks/api with a DeleteTaskTx method and a caller in media and in admin.
func TestTxCallCheckRejectsNonAdminCaller(t *testing.T) {
	fset := token.NewFileSet()
	apiPath := modulePrefix + "tasks/api"
	apiPkg := checkSource(t, fset, apiPath, "api", nil, `package api
type Admin interface{ DeleteTaskTx(id string) error }`)

	caller := `package p
import "` + apiPath + `"
func f(a api.Admin) error { return a.DeleteTaskTx("x") }`
	deps := map[string]*types.Package{apiPath: apiPkg}

	for _, tc := range []struct {
		pkgPath string
		want    int
	}{
		{modulePrefix + "media/application", 1},
		{modulePrefix + "tasks/application", 0}, // own module's api
		{modulePrefix + "admin/application", 0}, // the sanctioned caller
	} {
		file, info := parseAndCheck(t, fset, tc.pkgPath, deps, caller)
		got := txCallViolations(tc.pkgPath, fset, []*ast.File{file}, info)
		if len(got) != tc.want {
			t.Errorf("%s: %d violations %q, want %d", tc.pkgPath, len(got), got, tc.want)
		}
	}
}

func checkSource(t *testing.T, fset *token.FileSet, path, name string, deps map[string]*types.Package, src string) *types.Package {
	t.Helper()
	file, err := parser.ParseFile(fset, name+".go", src, 0)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := (&types.Config{Importer: mapImporter(deps)}).Check(path, fset, []*ast.File{file}, nil)
	if err != nil {
		t.Fatal(err)
	}
	return pkg
}

func parseAndCheck(t *testing.T, fset *token.FileSet, path string, deps map[string]*types.Package, src string) (*ast.File, *types.Info) {
	t.Helper()
	file, err := parser.ParseFile(fset, "caller.go", src, 0)
	if err != nil {
		t.Fatal(err)
	}
	info := &types.Info{Uses: map[*ast.Ident]types.Object{}}
	if _, err := (&types.Config{Importer: mapImporter(deps)}).Check(path, fset, []*ast.File{file}, info); err != nil {
		t.Fatal(err)
	}
	return file, info
}

type mapImporter map[string]*types.Package

func (m mapImporter) Import(path string) (*types.Package, error) {
	if p, ok := m[path]; ok {
		return p, nil
	}
	return importer.Default().Import(path)
}
