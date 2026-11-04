package architecturetest

import (
	"fmt"
	"go/ast"
	"go/parser"
	"go/token"
	"os"
	"path/filepath"
	"strconv"
	"strings"
	"testing"
)

type declaredEvent struct {
	Name    string // fixture basename, e.g. TaskCreated
	Version int
}

// TestEveryIntegrationEventHasAGoldenFixture is the "new event version requires a new
// fixture" rule: for each <X>EventType / <X>EventVersion const pair in a module's api
// package, api/testdata/<Event>.v<Version>.json must exist. The decode -> encode diff
// itself runs in the module's own events_golden_test.go (platform/events/goldentest),
// which this test also requires.
func TestEveryIntegrationEventHasAGoldenFixture(t *testing.T) {
	declared := 0
	for _, name := range moduleNames(t) {
		apiDir := filepath.Join(modulesDir, name, "api")
		events := eventsDeclaredIn(t, apiDir)
		declared += len(events)
		if len(events) == 0 {
			continue
		}
		for _, p := range missingFixtures(apiDir, events) {
			t.Errorf("module %q: %s", name, p)
		}
		if _, err := os.Stat(filepath.Join(apiDir, "events_golden_test.go")); err != nil {
			t.Errorf("module %q declares integration events but has no api/events_golden_test.go (use goldentest.Check)", name)
		}
	}
	if declared == 0 {
		t.Fatal("no integration events found in any api package: the scan is broken")
	}
}

// TestMissingFixtureIsReported is the negative self-test: a declared version without a
// fixture file is reported, and a bumped version needs its own file.
func TestMissingFixtureIsReported(t *testing.T) {
	dir := t.TempDir()
	if err := os.MkdirAll(filepath.Join(dir, "testdata"), 0o750); err != nil {
		t.Fatal(err)
	}
	if err := os.WriteFile(filepath.Join(dir, "testdata", "Thing.v1.json"), []byte("{}"), 0o600); err != nil {
		t.Fatal(err)
	}
	const src = `package api
const (
	ThingEventType    = "x.v1.Thing"
	ThingEventVersion = 2
)`
	fset := token.NewFileSet()
	file, err := parser.ParseFile(fset, "events.go", src, 0)
	if err != nil {
		t.Fatal(err)
	}
	events := eventsIn([]*ast.File{file})
	if len(events) != 1 || events[0] != (declaredEvent{"Thing", 2}) {
		t.Fatalf("events = %v, want [{Thing 2}]", events)
	}
	got := missingFixtures(dir, events)
	if len(got) != 1 || !strings.Contains(got[0], "Thing.v2.json") {
		t.Fatalf("missing = %q, want Thing.v2.json reported", got)
	}
	events[0].Version = 1
	if got := missingFixtures(dir, events); len(got) != 0 {
		t.Fatalf("with the fixture present nothing is missing, got %q", got)
	}
}

func missingFixtures(apiDir string, events []declaredEvent) []string {
	var out []string
	for _, e := range events {
		file := fmt.Sprintf("%s.v%d.json", e.Name, e.Version)
		if _, err := os.Stat(filepath.Join(apiDir, "testdata", file)); err != nil {
			out = append(out, fmt.Sprintf("event %s v%d has no fixture %s", e.Name, e.Version, filepath.ToSlash(filepath.Join(apiDir, "testdata", file))))
		}
	}
	return out
}

func eventsDeclaredIn(t *testing.T, apiDir string) []declaredEvent {
	t.Helper()
	_, files := parseDir(t, apiDir)
	return eventsIn(files)
}

// eventsIn pairs each `<X>EventType = "pkg.vN.Name"` const with `<X>EventVersion = N`.
func eventsIn(files []*ast.File) []declaredEvent {
	types, versions := map[string]string{}, map[string]int{}
	for _, f := range files {
		for _, decl := range f.Decls {
			gen, ok := decl.(*ast.GenDecl)
			if !ok || gen.Tok != token.CONST {
				continue
			}
			for _, spec := range gen.Specs {
				vs, ok := spec.(*ast.ValueSpec)
				if !ok || len(vs.Names) != 1 || len(vs.Values) != 1 {
					continue
				}
				lit, ok := vs.Values[0].(*ast.BasicLit)
				if !ok {
					continue
				}
				switch name := vs.Names[0].Name; {
				case strings.HasSuffix(name, "EventType"):
					if s, err := strconv.Unquote(lit.Value); err == nil {
						types[strings.TrimSuffix(name, "EventType")] = s
					}
				case strings.HasSuffix(name, "EventVersion"):
					if v, err := strconv.Atoi(lit.Value); err == nil {
						versions[strings.TrimSuffix(name, "EventVersion")] = v
					}
				}
			}
		}
	}
	var out []declaredEvent
	for prefix, typ := range types {
		out = append(out, declaredEvent{Name: typ[strings.LastIndex(typ, ".")+1:], Version: versions[prefix]})
	}
	return out
}
