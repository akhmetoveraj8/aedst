package architecturetest

import (
	"bufio"
	"fmt"
	"os"
	"slices"
	"strings"
	"testing"

	"golang.org/x/mod/modfile"
)

// approvedModulesFile is the allowlist of direct requires. It changes only together
// with docs/content/library-first/server.md (see the header of the file).
const approvedModulesFile = "approved_modules.txt"

// TestDirectRequiresAreApproved fails on a direct go.mod require that is not in
// approved_modules.txt, and on an approved entry that is no longer a direct
// require (a stale allowlist is a silent hole).
func TestDirectRequiresAreApproved(t *testing.T) {
	data, err := os.ReadFile("../go.mod")
	if err != nil {
		t.Fatalf("read go.mod: %v", err)
	}
	approved, err := readApproved(approvedModulesFile)
	if err != nil {
		t.Fatal(err)
	}
	for _, msg := range approvalProblems(t, data, approved) {
		t.Error(msg)
	}
}

// TestApprovalCheckRejectsUnapprovedRequire is the negative self-test: a go.mod with
// a direct require absent from the allowlist (and an indirect one, which is exempt)
// must be reported, and a stale allowlist entry too.
func TestApprovalCheckRejectsUnapprovedRequire(t *testing.T) {
	gomod := []byte("module x\n\ngo 1.27\n\nrequire (\n\texample.com/ok v1.0.0\n\texample.com/sneaky v1.0.0\n\texample.com/transitive v1.0.0 // indirect\n)\n")
	problems := approvalProblems(t, gomod, []string{"example.com/ok", "example.com/gone"})
	want := []string{
		"direct require example.com/sneaky is not in " + approvedModulesFile,
		"approved module example.com/gone is not a direct require in go.mod",
	}
	if !slices.Equal(problems, want) {
		t.Fatalf("problems = %q, want %q", problems, want)
	}
}

func approvalProblems(t *testing.T, gomod []byte, approved []string) []string {
	t.Helper()
	f, err := modfile.ParseLax("go.mod", gomod, nil)
	if err != nil {
		t.Fatalf("parse go.mod: %v", err)
	}
	direct := map[string]bool{}
	var problems []string
	for _, r := range f.Require {
		if r.Indirect {
			continue
		}
		direct[r.Mod.Path] = true
		if !slices.Contains(approved, r.Mod.Path) {
			problems = append(problems, fmt.Sprintf("direct require %s is not in %s", r.Mod.Path, approvedModulesFile))
		}
	}
	for _, a := range approved {
		if !direct[a] {
			problems = append(problems, fmt.Sprintf("approved module %s is not a direct require in go.mod", a))
		}
	}
	return problems
}

func readApproved(path string) ([]string, error) {
	file, err := os.Open(path)
	if err != nil {
		return nil, fmt.Errorf("open %s: %w", path, err)
	}
	defer file.Close()
	var out []string
	sc := bufio.NewScanner(file)
	for sc.Scan() {
		line, _, _ := strings.Cut(sc.Text(), "#")
		if line = strings.TrimSpace(line); line != "" {
			out = append(out, line)
		}
	}
	return out, sc.Err()
}
