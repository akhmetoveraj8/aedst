package architecturetest

import (
	"os"
	"regexp"
	"testing"
)

// River's schema is migrated by the river CLI in the migration image (and by
// `task migrate`), while the server verifies it at startup. The CLI must be the
// release the server links, or the schema it creates is not the one Verify expects.
var riverVersionSources = []struct {
	file, name string
	pattern    *regexp.Regexp
}{
	{"../go.mod", "go.mod", regexp.MustCompile(`(?m)^\s*github\.com/riverqueue/river (v[0-9][^\s]*)`)},
	{"../deployments/docker/Dockerfile.migrate", "Dockerfile.migrate", regexp.MustCompile(`riverqueue/river/cmd/river@(v[0-9][^\s]*)`)},
	{"../Taskfile.yml", "Taskfile RIVER_VERSION", regexp.MustCompile(`(?m)^\s*RIVER_VERSION:\s*(v[0-9][^\s]*)`)},
}

func TestRiverCLIVersionMatchesGoMod(t *testing.T) {
	versions := map[string]string{}
	for _, src := range riverVersionSources {
		raw, err := os.ReadFile(src.file)
		if err != nil {
			t.Fatalf("%s: %v", src.name, err)
		}
		m := src.pattern.FindStringSubmatch(string(raw))
		if m == nil {
			t.Fatalf("%s: no river version found (pattern %s)", src.name, src.pattern)
		}
		versions[src.name] = m[1]
	}
	want := versions["go.mod"]
	for name, got := range versions {
		if got != want {
			t.Errorf("%s pins river %s, go.mod has %s: bump them together", name, got, want)
		}
	}
}

func TestRiverVersionCheckRejectsDrift(t *testing.T) {
	re := riverVersionSources[1].pattern
	if m := re.FindStringSubmatch("go install github.com/riverqueue/river/cmd/river@v0.48.0"); m == nil || m[1] != "v0.48.0" {
		t.Fatalf("pattern does not extract the version: %v", m)
	}
}
