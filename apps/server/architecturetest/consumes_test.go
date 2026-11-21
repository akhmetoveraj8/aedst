package architecturetest

import (
	"go/ast"
	"go/parser"
	"go/token"
	"path/filepath"
	"sort"
	"strconv"
	"strings"
	"testing"
)

// A unit that is not hosted by a process is still a consumer of the events that
// process publishes. modulekit.Module.Consumes is the static catalog of what each
// unit subscribes to (Plan.RegisterRemoteConsumers feeds it to the registry of
// every other process); the real subscriptions are the Subscribe calls of the
// unit's infrastructure/events. If the two drift, a producer silently drops an
// event for the unit in the next topology, so they are compared here.

// subscription is one (event type, consumer) pair; the event type is the
// qualified Go expression ("<import path>.<Name>") or the literal string.
type subscription struct{ eventType, consumer string }

func (s subscription) String() string { return s.consumer + " <- " + s.eventType }

// declaredConsumes returns the pairs of every []modulekit.Consume literal in files.
func declaredConsumes(files []*ast.File) []subscription {
	var out []subscription
	for _, f := range files {
		imports, consts := fileScope(f)
		ast.Inspect(f, func(n ast.Node) bool {
			list, ok := n.(*ast.CompositeLit)
			if !ok {
				return true
			}
			arr, ok := list.Type.(*ast.ArrayType)
			if !ok || !isSelector(arr.Elt, "Consume") {
				return true
			}
			for _, el := range list.Elts {
				item, ok := el.(*ast.CompositeLit) // the element type is elided
				if !ok {
					continue
				}
				var s subscription
				for _, field := range item.Elts {
					kv, ok := field.(*ast.KeyValueExpr)
					if !ok {
						continue
					}
					key, _ := kv.Key.(*ast.Ident)
					if key == nil {
						continue
					}
					switch key.Name {
					case "EventType":
						s.eventType = resolveEventType(kv.Value, imports, consts)
					case "Consumer":
						s.consumer = resolveString(kv.Value, consts)
					}
				}
				out = append(out, s)
			}
			return false
		})
	}
	return out
}

// subscribedConsumers returns the pairs a unit's infrastructure/events register:
// calls of the shape <registry>.Subscribe(eventType, consumer, handler) and of a
// local helper subscribe(registry, pool, eventType, consumer, handler). A call whose
// arguments are not constants (the helper's own forwarding call) is not a
// subscription of its own and is skipped.
func subscribedConsumers(files []*ast.File) []subscription {
	var out []subscription
	for _, f := range files {
		imports, consts := fileScope(f)
		ast.Inspect(f, func(n ast.Node) bool {
			call, ok := n.(*ast.CallExpr)
			if !ok {
				return true
			}
			var typeArg, consumerArg ast.Expr
			switch fn := call.Fun.(type) {
			case *ast.SelectorExpr:
				if fn.Sel.Name == "Subscribe" && len(call.Args) == 3 {
					typeArg, consumerArg = call.Args[0], call.Args[1]
				}
			case *ast.Ident:
				if fn.Name == "subscribe" && len(call.Args) == 5 {
					typeArg, consumerArg = call.Args[2], call.Args[3]
				}
			}
			if typeArg == nil {
				return true
			}
			s := subscription{eventType: resolveEventType(typeArg, imports, consts), consumer: resolveString(consumerArg, consts)}
			if s.eventType != "" && s.consumer != "" {
				out = append(out, s)
			}
			return true
		})
	}
	return out
}

// diffConsumes describes how declared and subscribed differ, empty when they are
// the same set.
func diffConsumes(declared, subscribed []subscription) []string {
	set := func(in []subscription) map[subscription]bool {
		m := map[subscription]bool{}
		for _, s := range in {
			m[s] = true
		}
		return m
	}
	d, s := set(declared), set(subscribed)
	var problems []string
	for x := range s {
		if !d[x] {
			problems = append(problems, "subscribed in infrastructure/events but not declared in Module.Consumes: "+x.String())
		}
	}
	for x := range d {
		if !s[x] {
			problems = append(problems, "declared in Module.Consumes but never subscribed: "+x.String())
		}
	}
	sort.Strings(problems)
	return problems
}

func TestModuleConsumesMatchTheirSubscriptions(t *testing.T) {
	total := 0
	defer func() {
		// Not vacuous: the shipped consumers (notifications, search) must be seen.
		if total < 8 {
			t.Errorf("found %d declared consumers, want at least 8 (notifications 3 + search 5): the parser stopped matching", total)
		}
	}()
	for _, name := range moduleNames(t) {
		_, mod := parseDir(t, filepath.Join(modulesDir, name, "module"))
		declared := declaredConsumes(mod)
		total += len(declared)
		// The module's own consumers and those of its features (features/<f>/infrastructure/events).
		dirs, _ := filepath.Glob(filepath.Join(modulesDir, name, featuresDir, "*", "infrastructure", "events"))
		var infra []*ast.File
		for _, dir := range append([]string{filepath.Join(modulesDir, name, "infrastructure", "events")}, dirs...) {
			_, files := parseDir(t, dir)
			infra = append(infra, files...)
		}
		subscribed := subscribedConsumers(infra)
		for _, p := range diffConsumes(declared, subscribed) {
			t.Errorf("module %q: %s (keep internal/modules/%s/module Consumes equal to its infrastructure/events subscriptions)", name, p, name)
		}
		queueKey := strings.ReplaceAll(name, "/", "_") + "."
		for _, c := range declared {
			if !strings.HasPrefix(c.consumer, queueKey) {
				t.Errorf("module %q: consumer %q must start with %q: the prefix selects the unit's event queue (events.QueueFor)", name, c.consumer, queueKey)
			}
		}
	}
}

// The checker itself: a drifted declaration must be caught in both directions.
func TestConsumesCheckerSelfTest(t *testing.T) {
	const imports = `import (
		tasksapi "x/tasks/api"
		mediaapi "x/media/api"
	)
	const completed = "n.completed"
	`
	parse := func(body string) []*ast.File {
		f, err := parser.ParseFile(token.NewFileSet(), "x.go", "package p\n"+imports+body, 0)
		if err != nil {
			t.Fatal(err)
		}
		return []*ast.File{f}
	}
	infra := parse(`
	func Subscribe(registry R, pool P) {
		subscribe(registry, pool, tasksapi.DoneType, completed, nil)
		registry.Subscribe(mediaapi.ReadyType, "n.ready", nil)
	}
	func subscribe(registry R, pool P, eventType, consumer string, h H) {
		registry.Subscribe(eventType, consumer, nil) // forwarding call: not a subscription
	}`)
	subscribed := subscribedConsumers(infra)
	if len(subscribed) != 2 {
		t.Fatalf("subscribedConsumers found %v, want the two real subscriptions (not the helper's forwarding call)", subscribed)
	}

	same := parse(`var _ = []modulekit.Consume{
		{EventType: tasksapi.DoneType, Consumer: "n.completed"},
		{EventType: mediaapi.ReadyType, Consumer: "n.ready"},
	}`)
	if p := diffConsumes(declaredConsumes(same), subscribed); len(p) != 0 {
		t.Fatalf("an equal declaration was reported: %v", p)
	}
	missing := parse(`var _ = []modulekit.Consume{{EventType: tasksapi.DoneType, Consumer: "n.completed"}}`)
	if p := diffConsumes(declaredConsumes(missing), subscribed); len(p) != 1 || !strings.Contains(p[0], "not declared") {
		t.Fatalf("an undeclared subscription was not reported: %v", p)
	}
	extra := parse(`var _ = []modulekit.Consume{
		{EventType: tasksapi.DoneType, Consumer: "n.completed"},
		{EventType: mediaapi.ReadyType, Consumer: "n.ready"},
		{EventType: mediaapi.ReadyType, Consumer: "n.ghost"},
	}`)
	if p := diffConsumes(declaredConsumes(extra), subscribed); len(p) != 1 || !strings.Contains(p[0], "never subscribed") {
		t.Fatalf("a declaration with no subscription was not reported: %v", p)
	}
	wrongType := parse(`var _ = []modulekit.Consume{
		{EventType: mediaapi.ReadyType, Consumer: "n.completed"},
		{EventType: mediaapi.ReadyType, Consumer: "n.ready"},
	}`)
	if p := diffConsumes(declaredConsumes(wrongType), subscribed); len(p) != 2 {
		t.Fatalf("a declaration with the wrong event type was not reported both ways: %v", p)
	}
}

// fileScope returns the file's import aliases (name -> path) and string constants.
func fileScope(f *ast.File) (imports map[string]string, consts map[string]string) {
	imports, consts = map[string]string{}, map[string]string{}
	for _, imp := range f.Imports {
		path, _ := strconv.Unquote(imp.Path.Value)
		alias := path[strings.LastIndex(path, "/")+1:]
		if imp.Name != nil {
			alias = imp.Name.Name
		}
		imports[alias] = path
	}
	for _, d := range f.Decls {
		gen, ok := d.(*ast.GenDecl)
		if !ok || gen.Tok != token.CONST {
			continue
		}
		for _, spec := range gen.Specs {
			vs := spec.(*ast.ValueSpec)
			for i, id := range vs.Names {
				if i < len(vs.Values) {
					if lit, ok := vs.Values[i].(*ast.BasicLit); ok && lit.Kind == token.STRING {
						consts[id.Name], _ = strconv.Unquote(lit.Value)
					}
				}
			}
		}
	}
	return imports, consts
}

// resolveString returns the value of a string literal or a constant of the file.
func resolveString(e ast.Expr, consts map[string]string) string {
	switch v := e.(type) {
	case *ast.BasicLit:
		if v.Kind == token.STRING {
			s, _ := strconv.Unquote(v.Value)
			return s
		}
	case *ast.Ident:
		return consts[v.Name]
	}
	return ""
}

// resolveEventType returns "<import path>.<Name>" for pkg.Name, or the string value.
func resolveEventType(e ast.Expr, imports, consts map[string]string) string {
	if sel, ok := e.(*ast.SelectorExpr); ok {
		if pkg, ok := sel.X.(*ast.Ident); ok {
			if path, known := imports[pkg.Name]; known {
				return path + "." + sel.Sel.Name
			}
		}
		return ""
	}
	return resolveString(e, consts)
}

func isSelector(e ast.Expr, name string) bool {
	sel, ok := e.(*ast.SelectorExpr)
	return ok && sel.Sel.Name == name
}
