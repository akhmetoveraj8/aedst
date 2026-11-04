package architecturetest

import (
	"os"
	"regexp"
	"slices"
	"strings"
	"testing"
)

// moduleListSources are the hand-maintained copies of "which schemas have migrations".
// Each is parsed with its regexp (group 1 = the list) and compared with the
// directories under migrations/. Adding a schema means touching every one of them;
// this test is what makes forgetting one a failure instead of a silently skipped lint
// or a schema the deploy never migrates.
var moduleListSources = []struct {
	file, name string
	pattern    *regexp.Regexp
	reverse    bool
}{
	{"../Taskfile.yml", "Taskfile MODULES", regexp.MustCompile(`(?m)^\s*MODULES:\s*(.+)$`), false},
	{"../Taskfile.yml", "Taskfile MODULES_REVERSE", regexp.MustCompile(`(?m)^\s*MODULES_REVERSE:\s*(.+)$`), true},
	{"../scripts/lint-migrations.sh", "lint-migrations.sh MODULES", regexp.MustCompile(`MODULES="\$\{MODULES:-([^}]+)\}"`), false},
	{"../deployments/helm/aedst-server/values.yaml", "values.yaml migrations.modules", regexp.MustCompile(`(?m)^\s*modules:\s*\[([^\]]+)\]`), false},
}

// retiredSchemas keep their migration directory (goose must still apply the
// migration that drops them) but have no queries, so sqlc has no entry for them.
// auth: first-party authentication was removed in ADR-0019.
var retiredSchemas = []string{"auth"}

func TestMigrationModuleListsAgree(t *testing.T) {
	entries, err := os.ReadDir("../migrations")
	if err != nil {
		t.Fatal(err)
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, e.Name())
		}
	}
	slices.Sort(dirs)
	for _, src := range moduleListSources {
		raw, err := os.ReadFile(src.file)
		if err != nil {
			t.Errorf("%s: %v", src.name, err)
			continue
		}
		for _, p := range migrationListProblems(src.name, string(raw), src.pattern, src.reverse, dirs) {
			t.Error(p)
		}
	}
	// sqlc must also know every schema (platform included): queries for a schema
	// with no entry cannot be generated.
	sqlc, err := os.ReadFile("../sqlc.yaml")
	if err != nil {
		t.Fatal(err)
	}
	for _, d := range dirs {
		if slices.Contains(retiredSchemas, d) {
			continue
		}
		if !strings.Contains(string(sqlc), "migrations/"+d+"\n") {
			t.Errorf("sqlc.yaml has no entry with schema migrations/%s", d)
		}
	}
}

// TestMigrationListCheckRejectsDrift is the negative self-test.
func TestMigrationListCheckRejectsDrift(t *testing.T) {
	re := regexp.MustCompile(`MODULES: (.+)`)
	dirs := []string{"auth", "platform", "tasks"}
	if got := migrationListProblems("x", "MODULES: platform auth tasks", re, false, dirs); len(got) != 0 {
		t.Fatalf("conforming list reported: %q", got)
	}
	if got := migrationListProblems("x", "MODULES: platform auth", re, false, dirs); len(got) != 1 || !strings.Contains(got[0], "tasks") {
		t.Fatalf("a missing module must be reported, got %q", got)
	}
	if got := migrationListProblems("x", "MODULES: platform auth tasks ghost", re, false, dirs); len(got) != 1 || !strings.Contains(got[0], "ghost") {
		t.Fatalf("an extra module must be reported, got %q", got)
	}
	if got := migrationListProblems("x", "MODULES: auth platform tasks", re, false, dirs); len(got) != 1 || !strings.Contains(got[0], "platform first") {
		t.Fatalf("platform must come first, got %q", got)
	}
}

func migrationListProblems(name, content string, re *regexp.Regexp, reverse bool, dirs []string) []string {
	m := re.FindStringSubmatch(content)
	if m == nil {
		return []string{name + ": module list not found (pattern out of date?)"}
	}
	list := strings.Fields(strings.NewReplacer(",", " ", `"`, " ").Replace(m[1]))
	var out []string
	for _, d := range dirs {
		if !slices.Contains(list, d) {
			out = append(out, name+": missing "+d+" (a directory under migrations/)")
		}
	}
	for _, l := range list {
		if !slices.Contains(dirs, l) {
			out = append(out, name+": lists "+l+" but migrations/"+l+" does not exist")
		}
	}
	// platform owns tables other schemas reference: first on the way up, last on the way down.
	if len(out) == 0 {
		if (!reverse && list[0] != "platform") || (reverse && list[len(list)-1] != "platform") {
			out = append(out, name+": platform first (last in the reverse list): other schemas reference platform tables")
		}
	}
	return out
}
