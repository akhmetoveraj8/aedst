package modulekit

import (
	"strings"
	"testing"
)

func names(mods []Module) []string {
	out := make([]string, len(mods))
	for i, m := range mods {
		out[i] = m.Name
	}
	return out
}

func TestOrder_DependenciesFirstThenByName(t *testing.T) {
	got, err := order(map[string]Module{
		"admin":         {Name: "admin", Requires: []string{"tasks", "media"}},
		"media":         {Name: "media", Requires: []string{"tasks"}},
		"tasks":         {Name: "tasks"},
		"auth":          {Name: "auth"},
		"notifications": {Name: "notifications"},
	})
	if err != nil {
		t.Fatal(err)
	}
	want := "auth,notifications,tasks,media,admin"
	if joined := strings.Join(names(got), ","); joined != want {
		t.Errorf("order = %s, want %s", joined, want)
	}
}

func TestOrder_UnknownRequirement(t *testing.T) {
	_, err := order(map[string]Module{"media": {Name: "media", Requires: []string{"tasks"}}})
	if err == nil || !strings.Contains(err.Error(), `requires "tasks"`) {
		t.Fatalf("err = %v, want a missing-requirement error", err)
	}
}

func TestOrder_Cycle(t *testing.T) {
	_, err := order(map[string]Module{
		"a": {Name: "a", Requires: []string{"b"}},
		"b": {Name: "b", Requires: []string{"a"}},
	})
	if err == nil || !strings.Contains(err.Error(), "cycle") {
		t.Fatalf("err = %v, want a cycle error", err)
	}
}

func TestRegister_RejectsDuplicatesAndEmptyNames(t *testing.T) {
	for name, f := range map[string]func(){
		"empty":     func() { Register(Module{}) },
		"duplicate": func() { Register(Module{Name: "modulekit-test-dup"}); Register(Module{Name: "modulekit-test-dup"}) },
	} {
		func() {
			defer func() {
				if recover() == nil {
					t.Errorf("%s: Register did not panic", name)
				}
			}()
			f()
		}()
	}
}

type greeter interface{ Greet() string }

type hello struct{}

func (hello) Greet() string { return "hi" }

func TestProvideLookupRequire(t *testing.T) {
	env := &Env{}
	if _, ok := Lookup[greeter](env); ok {
		t.Fatal("Lookup found a service nobody provided")
	}
	if _, err := Require[greeter](env); err == nil {
		t.Fatal("Require must fail when nothing was provided")
	}
	Provide[greeter](env, hello{})
	g, err := Require[greeter](env)
	if err != nil || g.Greet() != "hi" {
		t.Fatalf("Require = %v, %v", g, err)
	}
}
