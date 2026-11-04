package config_test

import (
	"os"
	"path/filepath"
	"reflect"
	"regexp"
	"sort"
	"strings"
	"testing"

	"github.com/aedst/server/internal/platform/config"
)

// envNames returns every environment variable Config reads (its `env:` tags).
func envNames(t reflect.Type, out map[string]struct{}) {
	for i := range t.NumField() {
		f := t.Field(i)
		if f.Type.Kind() == reflect.Struct && f.Tag.Get("env") == "" {
			envNames(f.Type, out)
			continue
		}
		if name, _, _ := strings.Cut(f.Tag.Get("env"), ","); name != "" && name != "-" {
			out[name] = struct{}{}
		}
	}
}

func configEnvNames(t *testing.T) []string {
	t.Helper()
	set := map[string]struct{}{}
	envNames(reflect.TypeOf(config.Config{}), set)
	if len(set) < 50 {
		t.Fatalf("found only %d env tags; the reflection walk is broken", len(set))
	}
	names := make([]string, 0, len(set))
	for n := range set {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

func readFiles(t *testing.T, patterns ...string) string {
	t.Helper()
	var sb strings.Builder
	for _, p := range patterns {
		matches, err := filepath.Glob(filepath.Join("..", "..", "..", p))
		if err != nil || len(matches) == 0 {
			t.Fatalf("no files match %s", p)
		}
		for _, m := range matches {
			b, err := os.ReadFile(m)
			if err != nil {
				t.Fatal(err)
			}
			sb.Write(b)
			sb.WriteByte('\n')
		}
	}
	return sb.String()
}

func missingFrom(names []string, haystack string, exempt map[string]string) []string {
	var missing []string
	for _, n := range names {
		if _, ok := exempt[n]; ok {
			continue
		}
		if !regexp.MustCompile(`\b` + regexp.QuoteMeta(n) + `\b`).MatchString(haystack) {
			missing = append(missing, n)
		}
	}
	return missing
}

// Every variable the server reads is documented in .env.example (a commented
// `# AEDST_X=` line counts), so a new setting cannot ship undocumented.
func TestEveryEnvVarIsInEnvExample(t *testing.T) {
	names := configEnvNames(t)
	if missing := missingFrom(names, readFiles(t, ".env.example"), nil); len(missing) > 0 {
		t.Fatalf("add these to apps/server/.env.example:\n  %s", strings.Join(missing, "\n  "))
	}
}

// chartExempt lists variables the Helm chart deliberately does not render, each
// with the reason. Everything else must appear in the chart templates.
var chartExempt = map[string]string{
	"AEDST_ENV": "rendered from config.env",
}

// Every variable the server reads can be set through the Helm chart.
func TestEveryEnvVarIsInHelmChart(t *testing.T) {
	names := configEnvNames(t)
	chart := readFiles(t, "deployments/helm/aedst-server/templates/*.yaml", "deployments/helm/aedst-server/templates/*.tpl")
	if missing := missingFrom(names, chart, chartExempt); len(missing) > 0 {
		t.Fatalf("render these in deployments/helm/aedst-server/templates (configmap.yaml / deployment.yaml) or add them to chartExempt with a reason:\n  %s",
			strings.Join(missing, "\n  "))
	}
}
