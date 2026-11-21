package architecturetest

import (
	"os"
	"path/filepath"
	"regexp"
	"slices"
	"sort"
	"strings"
	"testing"
)

// The feature level (docs/content/architecture/modules-and-features.md): a
// module is split into features, internal/modules/<m>/features/<f>/<layer>.
// A feature is a vertical slice of its module, not a deployable unit: it has
// no api/, no module/ registration and no schema of its own. It uses the
// module's shared packages (api/, domain/, shared infrastructure and transport
// packages) and is composed only by <m>/module. Three gates, each with a
// negative self-test below:
//
//   - imports: featureViolation (a feature never imports another feature, a
//     shared package imports no feature, nothing outside the module imports one)
//     and siblingLayerViolation (the layer rules, relative to the feature and
//     against the module's shared packages);
//   - layout: featureLayoutProblems (only the known layers, nothing else);
//   - composition: uncomposedFeatures (every feature is wired by <m>/module).

// featureLayers are the only directories a feature may contain.
var featureLayers = []string{"application", "domain", "infrastructure", "transport"}

var featureName = regexp.MustCompile(`^[a-z][a-z0-9]*$`)

// featureViolation returns why pkg importing imp breaks the feature rules, or
// "" when it does not. Layering inside a feature and against the module's
// shared packages is siblingLayerViolation's part.
func featureViolation(pkg, imp string) string {
	target := featureOf(imp)
	if target == "" {
		return ""
	}
	module := moduleOf(imp)
	switch {
	case moduleOf(pkg) != module:
		return "a feature is internal to its module: other code uses the module's api/ (cmd/** its module/)"
	case featureOf(pkg) == target:
		return ""
	case featureOf(pkg) != "":
		return "a feature never imports another feature: move what they share to the module's own packages (api/, domain/, a shared infrastructure or transport package) or wire it in " + module + "/module"
	case layerOf(pkg, module) != "module":
		return "a module's shared packages import no feature: only " + module + "/module composes features"
	}
	return ""
}

// TestFeaturesMeetOnlyThroughTheirModule applies featureViolation to the real
// package graph.
func TestFeaturesMeetOnlyThroughTheirModule(t *testing.T) {
	features := 0
	for _, pkg := range loadPackages(t) {
		if featureOf(pkg.PkgPath) != "" {
			features++
		}
		for path := range pkg.Imports {
			if why := featureViolation(pkg.PkgPath, path); why != "" {
				t.Errorf("feature boundary violation: %s imports %s: %s", pkg.PkgPath, path, why)
			}
		}
	}
	if features == 0 {
		t.Error("no feature package in the graph: the reference split (modules/tasks/features) must be checked here")
	}
}

// TestFeatureCheckers is the negative self-test of the feature import rules.
func TestFeatureCheckers(t *testing.T) {
	const m = modulePrefix
	cases := []struct {
		name     string
		pkg, imp string
		feature  bool // featureViolation != ""
		layers   bool // siblingLayerViolation
		cross    bool // crossModuleViolation
	}{
		{"feature -> sibling feature, same layer", m + "wallet/features/transfer/application", m + "wallet/features/history/application", true, false, false},
		{"feature -> sibling feature infrastructure", m + "wallet/features/transfer/application", m + "wallet/features/history/infrastructure/postgres", true, false, false},
		{"feature transport -> sibling feature transport", m + "wallet/features/transfer/transport", m + "wallet/features/history/transport", true, false, false},
		{"feature application -> own domain is fine", m + "wallet/features/transfer/application", m + "wallet/features/transfer/domain", false, false, false},
		{"feature layering is relative to the feature", m + "wallet/features/transfer/domain", m + "wallet/features/transfer/infrastructure/postgres", false, true, false},
		{"feature application -> own infrastructure", m + "wallet/features/transfer/application", m + "wallet/features/transfer/infrastructure/postgres", false, true, false},
		{"feature transport -> own application", m + "wallet/features/transfer/transport", m + "wallet/features/transfer/application", false, true, false},
		{"feature application -> module shared domain is fine", m + "wallet/features/transfer/application", m + "wallet/domain", false, false, false},
		{"feature infrastructure -> module api is fine", m + "wallet/features/transfer/infrastructure/postgres", m + "wallet/api", false, false, false},
		{"feature infrastructure -> module shared infrastructure is fine", m + "wallet/features/transfer/infrastructure/postgres", m + "wallet/infrastructure/store", false, false, false},
		{"feature transport -> module api is fine", m + "wallet/features/transfer/transport", m + "wallet/api", false, false, false},
		{"feature transport -> module shared transport is fine", m + "wallet/features/transfer/transport", m + "wallet/transport/walletproto", false, false, false},
		{"feature transport -> module shared domain", m + "wallet/features/transfer/transport", m + "wallet/domain", false, true, false},
		{"feature domain -> module api", m + "wallet/features/transfer/domain", m + "wallet/api", false, true, false},
		{"feature application -> module shared infrastructure", m + "wallet/features/transfer/application", m + "wallet/infrastructure/store", false, true, false},
		{"feature -> its module's registration", m + "wallet/features/transfer/infrastructure/postgres", m + "wallet/module", false, true, false},
		{"module registration composes a feature", m + "wallet/module", m + "wallet/features/transfer/application", false, false, false},
		{"module api -> feature", m + "wallet/api", m + "wallet/features/transfer/application", true, false, false},
		{"module shared domain -> feature", m + "wallet/domain", m + "wallet/features/transfer/domain", true, false, false},
		{"module shared infrastructure -> feature", m + "wallet/infrastructure/store", m + "wallet/features/transfer/infrastructure/postgres", true, false, false},
		{"other module -> feature", m + "chat/application", m + "wallet/features/transfer/application", true, false, true},
		{"other module's feature -> feature", m + "chat/features/thread/application", m + "wallet/features/transfer/domain", true, false, true},
		{"other module's feature -> module api is fine", m + "chat/features/thread/application", m + "wallet/api", false, false, false},
		{"other module's feature -> module domain", m + "chat/features/thread/application", m + "wallet/domain", false, false, true},
		{"cmd -> feature", cmdPrefix + "server", m + "wallet/features/transfer/transport", true, false, true},
		{"platform -> feature", platformPrefix + "modulekit", m + "wallet/features/transfer/transport", true, false, true},
	}
	for _, tc := range cases {
		if got := featureViolation(tc.pkg, tc.imp) != ""; got != tc.feature {
			t.Errorf("%s: featureViolation = %v, want %v", tc.name, got, tc.feature)
		}
		if got := siblingLayerViolation(tc.pkg, tc.imp); got != tc.layers {
			t.Errorf("%s: siblingLayerViolation = %v, want %v", tc.name, got, tc.layers)
		}
		if got := crossModuleViolation(tc.pkg, tc.imp); got != tc.cross {
			t.Errorf("%s: crossModuleViolation = %v, want %v", tc.name, got, tc.cross)
		}
	}
	if got := featureOf(m + "wallet/features/transfer/infrastructure/postgres"); got != "transfer" {
		t.Errorf("featureOf(feature package) = %q", got)
	}
	if got := featureOf(m + "wallet/api"); got != "" {
		t.Errorf("featureOf(module package) = %q", got)
	}
	if got := unitOf(m + "wallet/features/transfer/domain"); got != "wallet/transfer" {
		t.Errorf("unitOf(feature package) = %q", got)
	}
	if got := layerOf(m+"wallet/features/transfer/infrastructure/postgres", "wallet"); got != "infrastructure" {
		t.Errorf("layerOf(feature package) = %q", got)
	}
}

// featureLayoutProblems checks the directory shape of every feature under
// modulesRoot: features/ holds only feature directories, a feature holds only
// the known layer directories (at least one, no file of its own), and a module
// that has features keeps its use cases in them, not in a module-level
// application/ beside them.
func featureLayoutProblems(modulesRoot string) []string {
	var problems []string
	modules, _ := os.ReadDir(modulesRoot)
	for _, m := range modules {
		if !m.IsDir() {
			continue
		}
		root := filepath.Join(modulesRoot, m.Name(), featuresDir)
		features, err := os.ReadDir(root)
		if err != nil {
			continue // no features/ level: a module with one capability does not need it
		}
		if len(features) == 0 {
			problems = append(problems, "module "+m.Name()+": features/ is empty")
		}
		if info, err := os.Stat(filepath.Join(modulesRoot, m.Name(), "application")); err == nil && info.IsDir() {
			problems = append(problems, "module "+m.Name()+" has features/ and a module-level application/: use cases live in the features")
		}
		for _, f := range features {
			unit := m.Name() + "/" + featuresDir + "/" + f.Name()
			if !f.IsDir() {
				problems = append(problems, unit+" is a file: features/ holds only feature directories")
				continue
			}
			if !featureName.MatchString(f.Name()) {
				problems = append(problems, unit+": a feature name is one lowercase word (it is a Go package path element)")
			}
			entries, _ := os.ReadDir(filepath.Join(root, f.Name()))
			layers := 0
			for _, e := range entries {
				switch {
				case !e.IsDir():
					problems = append(problems, unit+"/"+e.Name()+" is a file at the feature root: code lives in a layer ("+strings.Join(featureLayers, ", ")+")")
				case !slices.Contains(featureLayers, e.Name()):
					problems = append(problems, unit+"/"+e.Name()+" is not a feature layer: a feature holds only "+strings.Join(featureLayers, ", ")+" (api/ and module/ belong to the module)")
				default:
					layers++
				}
			}
			if layers == 0 {
				problems = append(problems, unit+" has no layer")
			}
		}
	}
	sort.Strings(problems)
	return problems
}

func TestEveryFeatureHoldsOnlyTheKnownLayers(t *testing.T) {
	for _, p := range featureLayoutProblems(modulesDir) {
		t.Error(p)
	}
}

func TestFeatureLayoutCheckRejectsAMalformedFeature(t *testing.T) {
	root := t.TempDir()
	mk := func(p ...string) {
		t.Helper()
		if err := os.MkdirAll(filepath.Join(append([]string{root}, p...)...), 0o755); err != nil {
			t.Fatal(err)
		}
	}
	touch := func(p ...string) {
		t.Helper()
		if err := os.WriteFile(filepath.Join(append([]string{root}, p...)...), []byte("package x\n"), 0o644); err != nil {
			t.Fatal(err)
		}
	}
	// conforming: a module without features, and one with two well-formed features.
	mk("chat", "application")
	mk("wallet", "api")
	mk("wallet", "domain")
	mk("wallet", "module")
	for _, layer := range featureLayers {
		mk("wallet", featuresDir, "transfer", layer)
	}
	mk("wallet", featuresDir, "history", "infrastructure", "postgres")
	if got := featureLayoutProblems(root); len(got) != 0 {
		t.Fatalf("conforming modules were reported: %q", got)
	}

	mk("shop", "application")                    // module-level use cases beside features
	mk("shop", featuresDir, "cart", "api")       // a feature has no api of its own
	mk("shop", featuresDir, "cart", "module")    // nor a registration
	mk("shop", featuresDir, "cart", "jobs")      // nor an ad-hoc layer
	touch("shop", featuresDir, "cart", "doc.go") // nor root files
	mk("shop", featuresDir, "empty")             // no layer at all
	mk("shop", featuresDir, "Check_Out", "domain")
	touch("shop", featuresDir, "notes.go")
	mk("bare", featuresDir)
	got := featureLayoutProblems(root)
	for _, want := range []string{
		"module shop has features/ and a module-level application/",
		"shop/features/cart/api is not a feature layer",
		"shop/features/cart/module is not a feature layer",
		"shop/features/cart/jobs is not a feature layer",
		"shop/features/cart/doc.go is a file at the feature root",
		"shop/features/empty has no layer",
		"shop/features/Check_Out: a feature name",
		"shop/features/notes.go is a file",
		"module bare: features/ is empty",
	} {
		if !slices.ContainsFunc(got, func(p string) bool { return strings.Contains(p, want) }) {
			t.Errorf("missing problem %q in %q", want, got)
		}
	}
}
