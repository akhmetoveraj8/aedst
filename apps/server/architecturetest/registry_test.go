package architecturetest

import (
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"regexp"
	"strconv"
	"strings"
	"testing"
)

const modulesDir = "../internal/modules"

// statelessModules own no tables, so they need no migrations/<module>
// directory. Adding a name here is a deliberate decision, reviewed with the module.
var statelessModules = map[string]bool{"capabilities": true}

func moduleNames(t *testing.T) []string {
	t.Helper()
	entries, err := os.ReadDir(modulesDir)
	if err != nil {
		t.Fatalf("read modules: %v", err)
	}
	var names []string
	for _, e := range entries {
		if e.IsDir() {
			names = append(names, e.Name())
		}
	}
	return names
}

// parseDir parses the non-test Go files of one directory.
func parseDir(t *testing.T, dir string) (*token.FileSet, []*ast.File) {
	t.Helper()
	fset := token.NewFileSet()
	matches, err := filepath.Glob(filepath.Join(dir, "*.go"))
	if err != nil {
		t.Fatal(err)
	}
	var files []*ast.File
	for _, name := range matches {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		f, err := parser.ParseFile(fset, name, nil, 0)
		if err != nil {
			t.Fatalf("parse %s: %v", name, err)
		}
		files = append(files, f)
	}
	return fset, files
}

// registeredNames returns the Name literal of every modulekit.Register(Module{Name: "..."})
// call found in files.
func registeredNames(files []*ast.File) []string {
	var names []string
	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			sel, ok := call.Fun.(*ast.SelectorExpr)
			if !ok || sel.Sel.Name != "Register" || len(call.Args) != 1 {
				return true
			}
			if pkg, ok := sel.X.(*ast.Ident); !ok || pkg.Name != "modulekit" {
				return true
			}
			lit, ok := call.Args[0].(*ast.CompositeLit)
			if !ok {
				return true
			}
			for _, el := range lit.Elts {
				kv, ok := el.(*ast.KeyValueExpr)
				if !ok {
					continue
				}
				if key, ok := kv.Key.(*ast.Ident); ok && key.Name == "Name" {
					if v, ok := kv.Value.(*ast.BasicLit); ok {
						if s, err := strconv.Unquote(v.Value); err == nil {
							names = append(names, s)
						}
					}
				}
			}
			return true
		})
	}
	return names
}

// TestEveryModuleRegistersAndIsLinked is the "new modules must register" rule
// (internal/platform/modulekit): each module has a module/ package whose init
// registers it under its directory name, and cmd/server/modules.go blank-imports
// that package. A module that is missing either is never built, mounted or
// consumed, and nothing else would notice.
func TestEveryModuleRegistersAndIsLinked(t *testing.T) {
	_, root := parseDir(t, "../cmd/server")
	imports := map[string]bool{}
	for _, f := range root {
		for _, imp := range f.Imports {
			path, _ := strconv.Unquote(imp.Path.Value)
			imports[path] = true
		}
	}
	for _, name := range moduleNames(t) {
		_, files := parseDir(t, filepath.Join(modulesDir, name, "module"))
		if len(files) == 0 {
			t.Errorf("module %q has no module/ package: add internal/modules/%s/module calling modulekit.Register", name, name)
			continue
		}
		got := registeredNames(files)
		if len(got) != 1 || got[0] != name {
			t.Errorf("module %q: internal/modules/%s/module registers %v, want exactly [%q]", name, name, got, name)
		}
		if path := modulePrefix + name + "/module"; !imports[path] {
			t.Errorf("module %q is not imported by cmd/server: add `_ %q` to cmd/server/modules.go", name, path)
		}
	}
}

var generatedHandlerCtor = regexp.MustCompile(`^Register\w+ServiceHandler$`)

// Every generated Connect handler registration (Register<Service>Handler) must
// be passed to modulekit.Mount (never called directly, which would bypass the
// shared chain and its protovalidate interceptor). Module packages may not
// build a connect.Server or call connecthttp.Mount themselves, and Handle may
// only receive the non-RPC handlers. Checked in cmd/server and in every module
// package.
func TestEveryConnectHandlerIsMountedThroughTheMounter(t *testing.T) {
	dirs := []string{"../cmd/server"}
	for _, name := range moduleNames(t) {
		dirs = append(dirs, filepath.Join(modulesDir, name, "module"))
	}
	mounted := 0
	for _, dir := range dirs {
		fset, files := parseDir(t, dir)
		for _, file := range files {
			ast.Inspect(file, func(n ast.Node) bool {
				call, ok := n.(*ast.CallExpr)
				if !ok {
					return true
				}
				sel, ok := call.Fun.(*ast.SelectorExpr)
				if !ok {
					return true
				}
				if generatedHandlerCtor.MatchString(sel.Sel.Name) {
					t.Errorf("%s: %s called directly — mount Connect services with modulekit.Mount so protovalidate always applies", fset.Position(call.Pos()), sel.Sel.Name)
				}
				if pkg, ok := sel.X.(*ast.Ident); ok && pkg.Name == "modulekit" && sel.Sel.Name == "Mount" {
					mounted++
				}
				if pkg, ok := sel.X.(*ast.Ident); ok && dir != "../cmd/server" &&
					(pkg.Name == "connect" && sel.Sel.Name == "NewServer" || pkg.Name == "connecthttp" && sel.Sel.Name == "Mount") {
					t.Errorf("%s: %s.%s in a module — its own connect.Server would bypass the shared chain; use modulekit.Mount", fset.Position(call.Pos()), pkg.Name, sel.Sel.Name)
				}
				if sel.Sel.Name == "Handle" {
					for _, arg := range call.Args {
						inner, ok := arg.(*ast.CallExpr)
						if !ok {
							continue
						}
						if isel, ok := inner.Fun.(*ast.SelectorExpr); ok {
							if pkg, ok := isel.X.(*ast.Ident); ok && pkg.Name != "grpchealth" && pkg.Name != "grpcreflect" {
								t.Errorf("%s: Handle(%s.%s(...)) — RPC services go through modulekit.Mount", fset.Position(call.Pos()), pkg.Name, isel.Sel.Name)
							}
						}
					}
				}
				return true
			})
		}
	}
	if want := len(moduleNames(t)); mounted < want {
		t.Errorf("%d modulekit.Mount calls for %d modules; every module mounts at least one service", mounted, want)
	}
}
