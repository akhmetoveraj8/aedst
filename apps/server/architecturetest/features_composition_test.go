package architecturetest

import (
	"os"
	"path/filepath"
	"slices"
	"strconv"
	"strings"
	"testing"
)

// uncomposedFeatures returns the features of module that none of the import
// paths (those of <module>/module) reaches into.
func uncomposedFeatures(module string, features []string, imports []string) []string {
	var out []string
	for _, f := range features {
		prefix := modulePrefix + module + "/" + featuresDir + "/" + f + "/"
		if !slices.ContainsFunc(imports, func(p string) bool { return strings.HasPrefix(p, prefix) }) {
			out = append(out, f)
		}
	}
	return out
}

// TestEveryFeatureIsComposedByItsModule: a feature is wired in exactly one
// place, <module>/module. A feature directory that package does not import is
// dead code that still looks like part of the product.
func TestEveryFeatureIsComposedByItsModule(t *testing.T) {
	for _, m := range moduleNames(t) {
		entries, err := os.ReadDir(filepath.Join(modulesDir, m, featuresDir))
		if err != nil {
			continue
		}
		var features []string
		for _, e := range entries {
			if e.IsDir() {
				features = append(features, e.Name())
			}
		}
		_, files := parseDir(t, filepath.Join(modulesDir, m, "module"))
		var imports []string
		for _, f := range files {
			for _, imp := range f.Imports {
				path, _ := strconv.Unquote(imp.Path.Value)
				imports = append(imports, path)
			}
		}
		for _, f := range uncomposedFeatures(m, features, imports) {
			t.Errorf("feature %s/%s is not imported by internal/modules/%s/module: compose it there (Setup/Mount) or delete it", m, f, m)
		}
	}
}

func TestCompositionCheckRejectsAnUnwiredFeature(t *testing.T) {
	imports := []string{
		modulePrefix + "wallet/api",
		modulePrefix + "wallet/features/transfer/application",
		modulePrefix + "wallet/features/transferplus/application",
	}
	if got := uncomposedFeatures("wallet", []string{"transfer"}, imports); len(got) != 0 {
		t.Fatalf("a composed feature was reported: %q", got)
	}
	got := uncomposedFeatures("wallet", []string{"transfer", "history", "transferp"}, imports)
	if !slices.Equal(got, []string{"history", "transferp"}) {
		t.Fatalf("uncomposedFeatures = %q, want history and transferp (a name prefix is not an import)", got)
	}
}
