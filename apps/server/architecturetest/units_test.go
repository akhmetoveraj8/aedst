package architecturetest

import (
	"go/ast"
	"go/importer"
	"go/parser"
	"go/token"
	"go/types"
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strconv"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

// ---- feature units: layout and registration -------------------------------

const migrationsDir = "../migrations"

// featureLayoutProblems checks every feature unit under modulesRoot
// (<m>/features/<f>): it has an api/ contract, a module/ package that registers
// exactly "<m>/<f>", and its own schema migrations/<m>_<f>. A feature is a unit
// like a module, so anything a module must have to be relocatable, it must have.
func featureLayoutProblems(modulesRoot, migrationsRoot string) []string {
	var problems []string
	modules, _ := os.ReadDir(modulesRoot)
	for _, m := range modules {
		if !m.IsDir() {
			continue
		}
		features, _ := os.ReadDir(filepath.Join(modulesRoot, m.Name(), featuresDir))
		for _, f := range features {
			if !f.IsDir() {
				continue
			}
			unit := m.Name() + "/" + f.Name()
			dir := filepath.Join(modulesRoot, m.Name(), featuresDir, f.Name())
			if info, err := os.Stat(filepath.Join(dir, "api")); err != nil || !info.IsDir() {
				problems = append(problems, "feature "+unit+" has no api/ package")
			}
			if info, err := os.Stat(filepath.Join(dir, "module")); err != nil || !info.IsDir() {
				problems = append(problems, "feature "+unit+" has no module/ package calling modulekit.Register")
			} else if got := registeredIn(filepath.Join(dir, "module")); len(got) != 1 || got[0] != unit {
				problems = append(problems, "feature "+unit+": module/ registers "+strings.Join(got, ",")+", want exactly "+unit)
			}
			schema := m.Name() + "_" + f.Name()
			if info, err := os.Stat(filepath.Join(migrationsRoot, schema)); err != nil || !info.IsDir() {
				problems = append(problems, "feature "+unit+" has no migrations/"+schema+" directory (a feature owns the schema "+schema+")")
			}
		}
	}
	return problems
}

func registeredIn(dir string) []string {
	fset := token.NewFileSet()
	matches, _ := filepath.Glob(filepath.Join(dir, "*.go"))
	var files []*ast.File
	for _, name := range matches {
		if strings.HasSuffix(name, "_test.go") {
			continue
		}
		if f, err := parser.ParseFile(fset, name, nil, 0); err == nil {
			files = append(files, f)
		}
	}
	return registeredNames(files)
}

func TestEveryFeatureHasTheShapeOfAUnit(t *testing.T) {
	for _, p := range featureLayoutProblems(modulesDir, migrationsDir) {
		t.Error(p)
	}
}

// TestEveryFeatureIsLinked: cmd/server blank-imports every feature's module/
// package, so a feature that exists on disk is a feature that is registered.
func TestEveryFeatureIsLinked(t *testing.T) {
	_, root := parseDir(t, "../cmd/server")
	imports := map[string]bool{}
	for _, f := range root {
		for _, imp := range f.Imports {
			path, _ := strconv.Unquote(imp.Path.Value)
			imports[path] = true
		}
	}
	for _, m := range moduleNames(t) {
		features, _ := os.ReadDir(filepath.Join(modulesDir, m, featuresDir))
		for _, f := range features {
			if path := modulePrefix + m + "/" + featuresDir + "/" + f.Name() + "/module"; f.IsDir() && !imports[path] {
				t.Errorf("feature %s/%s is not imported by cmd/server: add `_ %q` to cmd/server/modules.go", m, f.Name(), path)
			}
		}
	}
}

func TestFeatureLayoutCheckRejectsAnIncompleteFeature(t *testing.T) {
	root, mig := t.TempDir(), t.TempDir()
	mk := func(p ...string) {
		if err := os.MkdirAll(filepath.Join(p...), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	// complete: api, module registering social/like, schema social_like.
	mk(root, "social", featuresDir, "like", "api")
	mk(root, "social", featuresDir, "like", "module")
	mk(mig, "social_like")
	src := `package module
import "github.com/aedst/server/internal/platform/modulekit"
func init() { modulekit.Register(modulekit.Module{Name: "social/like"}) }`
	if err := os.WriteFile(filepath.Join(root, "social", featuresDir, "like", "module", "module.go"), []byte(src), 0o644); err != nil {
		t.Fatal(err)
	}
	if got := featureLayoutProblems(root, mig); len(got) != 0 {
		t.Fatalf("a complete feature was reported: %q", got)
	}
	// incomplete: nothing.
	mk(root, "social", featuresDir, "comment")
	got := featureLayoutProblems(root, mig)
	for _, want := range []string{"social/comment has no api/", "social/comment has no module/", "migrations/social_comment"} {
		if !slices.ContainsFunc(got, func(p string) bool { return strings.Contains(p, want) }) {
			t.Errorf("missing problem %q in %q", want, got)
		}
	}
}

// ---- a unit owns its schema: no references into another unit's schema ------

var schemaRef = func(schema string) *regexp.Regexp {
	return regexp.MustCompile(`(?i)\b` + regexp.QuoteMeta(schema) + `\.[a-z_][a-z0-9_]*`)
}

// crossSchemaRefs returns the references in sql (a query or a migration) to
// another unit's schema. platform.* is shared infrastructure by design
// (idempotency keys, event deliveries) and is exempt. Comments are ignored.
func crossSchemaRefs(sql, own string, schemas []string) []string {
	var code strings.Builder
	for line := range strings.SplitSeq(sql, "\n") {
		if i := strings.Index(line, "--"); i >= 0 {
			line = line[:i]
		}
		code.WriteString(line)
		code.WriteByte('\n')
	}
	var out []string
	for _, s := range schemas {
		if s == own || s == "platform" {
			continue
		}
		out = append(out, schemaRef(s).FindAllString(code.String(), -1)...)
	}
	sort.Strings(out)
	return out
}

// TestUnitsOnlyTouchTheirOwnSchema is rule 3 of the architecture (no SQL against
// another module's schema) as a gate on the SQL itself. It is what lets a unit
// move to its own database: a cross-schema JOIN or FOREIGN KEY would not survive.
func TestUnitsOnlyTouchTheirOwnSchema(t *testing.T) {
	entries, err := os.ReadDir(migrationsDir)
	if err != nil {
		t.Fatal(err)
	}
	var schemas []string
	for _, e := range entries {
		if e.IsDir() {
			schemas = append(schemas, e.Name())
		}
	}
	for _, root := range []string{"../sql", migrationsDir} {
		for _, own := range schemas {
			files, _ := filepath.Glob(filepath.Join(root, own, "*.sql"))
			for _, f := range files {
				raw, err := os.ReadFile(f)
				if err != nil {
					t.Fatal(err)
				}
				for _, ref := range crossSchemaRefs(string(raw), own, schemas) {
					t.Errorf("%s references %s: a unit may only touch its own schema (%s) and platform.*; read other units through their api/ or an event projection", f, ref, own)
				}
			}
		}
	}
}

func TestCrossSchemaCheckRejectsReferences(t *testing.T) {
	schemas := []string{"admin", "media", "platform", "tasks"}
	ok := "SELECT * FROM media.uploads u WHERE u.id = $1; -- tasks.tasks is only a comment\nINSERT INTO platform.idempotency_keys VALUES ($1)"
	if got := crossSchemaRefs(ok, "media", schemas); len(got) != 0 {
		t.Fatalf("conforming SQL reported: %q", got)
	}
	bad := "SELECT * FROM media.uploads m JOIN tasks.tasks t ON t.id = m.task_id"
	if got := crossSchemaRefs(bad, "media", schemas); len(got) != 1 || got[0] != "tasks.tasks" {
		t.Fatalf("a cross-schema JOIN must be reported, got %q", got)
	}
	fk := "ALTER TABLE media.uploads ADD FOREIGN KEY (task_id) REFERENCES tasks.tasks (id)"
	if got := crossSchemaRefs(fk, "media", schemas); len(got) != 1 {
		t.Fatalf("a cross-schema FOREIGN KEY must be reported, got %q", got)
	}
}

// ---- a unit reachable over the network has a network-safe contract ---------

// networkForbiddenPackages hold types that only make sense inside one process:
// a database transaction or connection, an HTTP request, a file or stream.
var networkForbiddenPackages = []string{
	"github.com/jackc/pgx", "database/sql", "net/http", "net", "os", "io", "bufio",
	"github.com/riverqueue/river",
}

func forbiddenPackage(path string) bool {
	return slices.ContainsFunc(networkForbiddenPackages, func(p string) bool {
		return path == p || strings.HasPrefix(path, p+"/")
	})
}

// networkSafe returns why t cannot cross a process boundary, or "" if it can: it
// must be made of basic types, time, ids, and structs/slices/maps/pointers of
// those. Contexts are allowed only as a first parameter (checked by the caller).
func networkSafe(t types.Type, seen map[types.Type]bool) string {
	if seen[t] {
		return ""
	}
	seen[t] = true
	switch u := t.(type) {
	case *types.Basic:
		if u.Kind() == types.UnsafePointer {
			return "unsafe.Pointer"
		}
		return ""
	case *types.Named:
		if pkg := u.Obj().Pkg(); pkg != nil {
			switch p := pkg.Path(); {
			case p == "time" && (u.Obj().Name() == "Time" || u.Obj().Name() == "Duration"):
				return ""
			case strings.HasSuffix(p, "/internal/shared/ids"):
				return ""
			case forbiddenPackage(p):
				return u.Obj().Pkg().Path() + "." + u.Obj().Name() + " is in-process only"
			}
		} else if u.Obj().Name() == "error" {
			return "" // universe error: allowed as a result
		}
		return networkSafe(u.Underlying(), seen)
	case *types.Pointer:
		return networkSafe(u.Elem(), seen)
	case *types.Slice:
		return networkSafe(u.Elem(), seen)
	case *types.Array:
		return networkSafe(u.Elem(), seen)
	case *types.Map:
		if why := networkSafe(u.Key(), seen); why != "" {
			return why
		}
		return networkSafe(u.Elem(), seen)
	case *types.Struct:
		for f := range u.Fields() {
			if !f.Exported() {
				return "struct has unexported field " + f.Name() + " (it would not survive serialization)"
			}
			if why := networkSafe(f.Type(), seen); why != "" {
				return f.Name() + ": " + why
			}
		}
		return ""
	case *types.Chan:
		return "channel"
	case *types.Signature:
		return "function value"
	case *types.Interface:
		return "interface value " + u.String()
	}
	return "unsupported type " + t.String()
}

// interfaceProblems checks every method of iface: a context.Context as the first
// parameter, network-safe parameters and results, error as the last result.
func interfaceProblems(name string, iface *types.Interface) []string {
	var out []string
	for m := range iface.Methods() {
		sig := m.Signature()
		for i := 0; i < sig.Params().Len(); i++ {
			p := sig.Params().At(i)
			if i == 0 && p.Type().String() == "context.Context" {
				continue
			}
			if why := networkSafe(p.Type(), map[types.Type]bool{}); why != "" {
				out = append(out, name+"."+m.Name()+" parameter "+p.Name()+": "+why)
			}
		}
		for r := range sig.Results().Variables() {
			if r.Type().String() == "error" {
				continue
			}
			if why := networkSafe(r.Type(), map[types.Type]bool{}); why != "" {
				out = append(out, name+"."+m.Name()+" result: "+why)
			}
		}
		if sig.Results().Len() == 0 || sig.Results().At(sig.Results().Len()-1).Type().String() != "error" {
			out = append(out, name+"."+m.Name()+" must return error last: a call over the network can always fail")
		}
	}
	return out
}

func TestNetworkSafetyCheckerRejectsInProcessTypes(t *testing.T) {
	src := `package p
import ("context"; "database/sql"; "io")
type ID [16]byte
type Item struct { ID ID; Name string; Tags []string }
type Good interface {
	Get(ctx context.Context, id ID) (Item, error)
	List(ctx context.Context, owners []ID) (map[ID]int64, error)
}
type InTx interface{ Do(ctx context.Context, tx *sql.Tx) error }
type Streams interface{ Read(ctx context.Context, r io.Reader) error }
type Chans interface{ Watch(ctx context.Context) (<-chan Item, error) }
type Funcs interface{ Each(ctx context.Context, f func(Item)) error }
type Anys interface{ Put(ctx context.Context, v any) error }
type NoErr interface{ Count(ctx context.Context) int }
type Hidden struct{ n int }
type Unexported interface{ Put(ctx context.Context, h Hidden) error }
`
	fset := token.NewFileSet()
	f, err := parser.ParseFile(fset, "p.go", src, 0)
	if err != nil {
		t.Fatal(err)
	}
	pkg, err := (&types.Config{Importer: importer.ForCompiler(fset, "source", nil)}).Check("p", fset, []*ast.File{f}, nil)
	if err != nil {
		t.Fatalf("type-check the fixture: %v", err)
	}
	iface := func(name string) *types.Interface {
		return pkg.Scope().Lookup(name).Type().Underlying().(*types.Interface)
	}
	if got := interfaceProblems("Good", iface("Good")); len(got) != 0 {
		t.Fatalf("a network-safe interface was reported: %q", got)
	}
	for _, name := range []string{"InTx", "Streams", "Chans", "Funcs", "Anys", "NoErr", "Unexported"} {
		if got := interfaceProblems(name, iface(name)); len(got) == 0 {
			t.Errorf("%s must be rejected", name)
		}
	}
	for _, p := range []string{"github.com/jackc/pgx/v5", "github.com/jackc/pgx/v5/pgxpool", "net/http", "database/sql"} {
		if !forbiddenPackage(p) {
			t.Errorf("%s must be forbidden", p)
		}
	}
	if forbiddenPackage("time") || forbiddenPackage("github.com/aedst/server/internal/shared/ids") {
		t.Error("time and ids are network-safe")
	}
}

// TestRemoteHooksProvideNetworkSafeContracts: a unit that declares a Remote hook
// promises its contract can be served over a connection. Every interface that hook
// provides (modulekit.Provide[T]) is checked method by method.
func TestRemoteHooksProvideNetworkSafeContracts(t *testing.T) {
	cfg := &packages.Config{Mode: packages.NeedName | packages.NeedSyntax | packages.NeedTypes | packages.NeedTypesInfo | packages.NeedImports | packages.NeedDeps}
	pkgs, err := packages.Load(cfg, "../internal/modules/...")
	if err != nil {
		t.Fatal(err)
	}
	checked := 0
	for _, pkg := range pkgs {
		if layerOf(pkg.PkgPath, moduleOf(pkg.PkgPath)) != "module" {
			continue
		}
		for _, name := range remoteHookNames(pkg.Syntax) {
			for _, provided := range providedIn(pkg, name) {
				iface, ok := provided.Underlying().(*types.Interface)
				if !ok {
					t.Errorf("%s: Remote hook %s provides %s, which is not an interface", pkg.PkgPath, name, provided)
					continue
				}
				checked++
				for _, p := range interfaceProblems(provided.String(), iface) {
					t.Errorf("%s: the Remote hook provides a contract that cannot cross a process boundary: %s", pkg.PkgPath, p)
				}
			}
		}
	}
	if checked == 0 {
		t.Error("no Remote hook provides any contract: the pilot (tasks.Ownership) must be checked here")
	}
}

// remoteHookNames returns the function names assigned to `Remote:` in modulekit.Register literals.
func remoteHookNames(files []*ast.File) []string {
	var out []string
	for _, f := range files {
		ast.Inspect(f, func(n ast.Node) bool {
			kv, ok := n.(*ast.KeyValueExpr)
			if !ok {
				return true
			}
			if key, ok := kv.Key.(*ast.Ident); ok && key.Name == "Remote" {
				if v, ok := kv.Value.(*ast.Ident); ok {
					out = append(out, v.Name)
				}
			}
			return true
		})
	}
	return out
}

// providedIn returns the type arguments of every modulekit.Provide[T] call in the
// body of the function named fn.
func providedIn(pkg *packages.Package, fn string) []types.Type {
	var out []types.Type
	for _, f := range pkg.Syntax {
		for _, d := range f.Decls {
			fd, ok := d.(*ast.FuncDecl)
			if !ok || fd.Name.Name != fn || fd.Body == nil {
				continue
			}
			ast.Inspect(fd.Body, func(n ast.Node) bool {
				id, ok := n.(*ast.Ident)
				if !ok || id.Name != "Provide" {
					return true
				}
				if inst, ok := pkg.TypesInfo.Instances[id]; ok && inst.TypeArgs.Len() == 1 {
					out = append(out, inst.TypeArgs.At(0))
				}
				return true
			})
		}
	}
	return out
}
