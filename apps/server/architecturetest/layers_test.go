package architecturetest

import (
	"slices"
	"strings"
	"testing"
)

// expectedModules is the set of modules this repo ships. TestModulesAreDiscovered
// fails when one disappears from the package graph, so the boundary tests above
// can never silently stop covering a module (they discover modules from the
// directory tree, which would otherwise pass vacuously on an empty set).
var expectedModules = []string{"admin", "appattest", "capabilities", "integrity", "media", "notifications", "search", "tasks"}

// forbiddenSiblingLayers maps a layer to the sibling layers of the SAME module it must
// never import: domain -> application -> infrastructure -> transport -> api.
// A layer may import layers to its left, never to its right. The single transport
// rule: transport imports only its own api (plus platform and shared), never
// domain or application; api is the adapter over application and domain.
//
// "module" is the registration package (modulekit): the outermost layer, wired
// only by cmd/server, imported by no other layer.
var forbiddenSiblingLayers = map[string][]string{
	"domain":         {"application", "infrastructure", "transport", "jobs", "api", "module"},
	"application":    {"infrastructure", "transport", "jobs", "module"},
	"infrastructure": {"module"},
	"transport":      {"domain", "application", "infrastructure", "jobs", "module"},
	"jobs":           {"module"},
	"api":            {"infrastructure", "transport", "jobs", "module"},
}

// crossModuleViolation reports whether pkg (a package path) importing imp
// reaches into another module other than through its api/ package. The one
// exception is the composition root: cmd/** imports <module>/module (and only that).
func crossModuleViolation(pkg, imp string) bool {
	owner, target := moduleOf(pkg), moduleOf(imp)
	if target == "" || target == owner {
		return false
	}
	layer := layerOf(imp, target)
	if layer == "module" && strings.HasPrefix(pkg, cmdPrefix) {
		return false
	}
	return layer != "api" && layer != ""
}

// siblingLayerViolation reports whether pkg imports a layer of its own module
// that forbiddenSiblingLayers forbids for pkg's layer.
func siblingLayerViolation(pkg, imp string) bool {
	module := moduleOf(pkg)
	if module == "" || unitOf(imp) != unitOf(pkg) {
		return false
	}
	return slices.Contains(forbiddenSiblingLayers[layerOf(pkg, module)], layerOf(imp, module))
}

// unitViolation reports whether pkg imports another unit of its OWN module (a
// module and its features, or two features) other than through the contract.
// Units of one module meet exactly like units of different modules do: through
// api/. Beyond that the arrow is one-way: a module composes its features, a
// feature never reaches up into the module that groups it.
func unitViolation(pkg, imp string) bool {
	module := moduleOf(pkg)
	if module == "" || moduleOf(imp) != module || unitOf(pkg) == unitOf(imp) {
		return false
	}
	if unitOf(pkg) != module { // pkg is a feature
		if unitOf(imp) == module {
			return true // a feature importing its parent module
		}
	}
	return layerOf(imp, module) != "api" // reaching into a feature other than via its api
}

func TestModulesAreDiscovered(t *testing.T) {
	seen := map[string]bool{}
	for _, pkg := range loadPackages(t) {
		if m := moduleOf(pkg.PkgPath); m != "" {
			seen[m] = true
		}
	}
	for _, m := range expectedModules {
		if !seen[m] {
			t.Errorf("module %q is not in the package graph: boundary tests would not cover it", m)
		}
	}
	for m := range seen {
		if !slices.Contains(expectedModules, m) {
			t.Errorf("module %q is new: add it to expectedModules in architecturetest/layers_test.go", m)
		}
	}
}

// TestUnitsOfOneModuleMeetOnlyThroughAPI applies the module rule one level down:
// the features of a module (modules/<m>/features/<f>) are units like modules are.
func TestUnitsOfOneModuleMeetOnlyThroughAPI(t *testing.T) {
	for _, pkg := range loadPackages(t) {
		for path := range pkg.Imports {
			if unitViolation(pkg.PkgPath, path) {
				t.Errorf("unit boundary violation: %s imports %s — units of one module (a module and its features, or two features) meet only through api/, and a feature never imports the module that groups it", pkg.PkgPath, path)
			}
		}
	}
}

// TestUnitCheckers is the negative self-test of the feature-level rules.
func TestUnitCheckers(t *testing.T) {
	const m = modulePrefix
	cases := []struct {
		name         string
		pkg, imp     string
		unit, layers bool // unitViolation, siblingLayerViolation
		cross        bool // crossModuleViolation
	}{
		{"module composes a feature through its api", m + "social/application", m + "social/features/like/api", false, false, false},
		{"module reaching into a feature's domain", m + "social/application", m + "social/features/like/domain", true, false, false},
		{"feature reaching into a sibling feature's infrastructure", m + "social/features/comment/application", m + "social/features/like/infrastructure/postgres", true, false, false},
		{"feature using a sibling feature's api", m + "social/features/comment/application", m + "social/features/like/api", false, false, false},
		{"feature importing its parent module's api", m + "social/features/like/application", m + "social/api", true, false, false},
		{"feature importing its parent module's domain", m + "social/features/like/application", m + "social/domain", true, false, false},
		{"feature layering is relative to the feature", m + "social/features/like/domain", m + "social/features/like/infrastructure/postgres", false, true, false},
		{"feature application -> own domain is fine", m + "social/features/like/application", m + "social/features/like/domain", false, false, false},
		{"other module uses a feature's api", m + "chat/application", m + "social/features/like/api", false, false, false},
		{"other module reaching into a feature", m + "chat/application", m + "social/features/like/application", false, false, true},
		{"cmd -> feature registration is fine", cmdPrefix + "server", m + "social/features/like/module", false, false, false},
		{"non-cmd -> feature registration", m + "chat/application", m + "social/features/like/module", false, false, true},
	}
	for _, tc := range cases {
		if got := unitViolation(tc.pkg, tc.imp); got != tc.unit {
			t.Errorf("%s: unitViolation = %v, want %v", tc.name, got, tc.unit)
		}
		if got := siblingLayerViolation(tc.pkg, tc.imp); got != tc.layers {
			t.Errorf("%s: siblingLayerViolation = %v, want %v", tc.name, got, tc.layers)
		}
		if got := crossModuleViolation(tc.pkg, tc.imp); got != tc.cross {
			t.Errorf("%s: crossModuleViolation = %v, want %v", tc.name, got, tc.cross)
		}
	}
	if got := unitOf(m + "social/features/like/api"); got != "social/like" {
		t.Errorf("unitOf(feature) = %q", got)
	}
	if got := unitOf(m + "social/api"); got != "social" {
		t.Errorf("unitOf(module) = %q", got)
	}
}

// TestLayersOnlyImportInward enforces the intra-module layering for every
// module: domain depends on neither application, infrastructure, transport,
// jobs nor api; application depends on neither infrastructure, transport nor jobs.
func TestLayersOnlyImportInward(t *testing.T) {
	for _, pkg := range loadPackages(t) {
		for path := range pkg.Imports {
			if siblingLayerViolation(pkg.PkgPath, path) {
				t.Errorf("layering violation: %s (%s) imports %s", pkg.PkgPath, layerOf(pkg.PkgPath, moduleOf(pkg.PkgPath)), path)
			}
		}
	}
}

// TestDomainImportsOnlyStdlibAndShared mirrors the depguard rule
// domain-is-pure on resolved import paths: a domain package may import the
// standard library, third-party value libraries and internal/shared, but never
// internal/platform or any module.
func TestDomainImportsOnlyStdlibAndShared(t *testing.T) {
	for _, pkg := range loadPackages(t) {
		module := moduleOf(pkg.PkgPath)
		if module == "" || layerOf(pkg.PkgPath, module) != "domain" {
			continue
		}
		for path := range pkg.Imports {
			if strings.HasPrefix(path, platformPrefix) || strings.HasPrefix(path, modulePrefix) {
				t.Errorf("layering violation: domain package %s imports %s (domain may use stdlib and internal/shared only)", pkg.PkgPath, path)
			}
		}
	}
}

func TestBoundaryCheckers(t *testing.T) {
	const m = modulePrefix
	cases := []struct {
		name       string
		pkg, imp   string
		wantCross  bool
		wantLayers bool
	}{
		{"other module api is allowed", m + "media/application", m + "tasks/api", false, false},
		{"other module application is a violation", m + "media/application", m + "tasks/application", true, false},
		{"other module infrastructure is a violation", m + "admin/transport", m + "notifications/infrastructure/postgres", true, false},
		{"other module domain is a violation", m + "search/infrastructure/events", m + "tasks/domain", true, false},
		{"admin reaching media transport", m + "admin/application", m + "media/transport", true, false},
		{"appattest reaching integrity domain", m + "appattest/application", m + "integrity/domain", true, false},
		{"own module any layer is fine for the cross check", m + "media/application", m + "media/domain", false, false},
		{"platform import is not a module import", m + "media/application", platformPrefix + "storage", false, false},
		{"domain -> own infrastructure", m + "media/domain", m + "media/infrastructure/postgres", false, true},
		{"domain -> own transport", m + "notifications/domain", m + "notifications/transport", false, true},
		{"domain -> own application", m + "search/domain", m + "search/application", false, true},
		{"application -> own infrastructure", m + "tasks/application", m + "tasks/infrastructure/postgres", false, true},
		{"application -> own transport", m + "tasks/application", m + "tasks/transport", false, true},
		{"application -> own domain is fine", m + "tasks/application", m + "tasks/domain", false, false},
		{"infrastructure -> own domain is fine", m + "tasks/infrastructure/postgres", m + "tasks/domain", false, false},
		{"transport -> own application", m + "tasks/transport", m + "tasks/application", false, true},
		{"transport -> own domain", m + "appattest/transport", m + "appattest/domain", false, true},
		{"transport -> own infrastructure", m + "tasks/transport", m + "tasks/infrastructure/postgres", false, true},
		{"transport -> own api is fine", m + "tasks/transport", m + "tasks/api", false, false},
		{"api -> own application is fine", m + "tasks/api", m + "tasks/application", false, false},
		{"api -> own domain is fine", m + "tasks/api", m + "tasks/domain", false, false},
		{"api -> own infrastructure", m + "tasks/api", m + "tasks/infrastructure/postgres", false, true},
		{"api -> own transport", m + "tasks/api", m + "tasks/transport", false, true},
		{"cmd -> module registration is fine", cmdPrefix + "server", m + "tasks/module", false, false},
		{"cmd -> module api is fine", cmdPrefix + "server", m + "tasks/api", false, false},
		{"cmd -> module application", cmdPrefix + "server", m + "tasks/application", true, false},
		{"cmd -> module infrastructure", cmdPrefix + "server", m + "tasks/infrastructure/postgres", true, false},
		{"non-cmd -> other module registration", m + "admin/application", m + "tasks/module", true, false},
	}
	for _, tc := range cases {
		if got := crossModuleViolation(tc.pkg, tc.imp); got != tc.wantCross {
			t.Errorf("%s: crossModuleViolation = %v, want %v", tc.name, got, tc.wantCross)
		}
		if got := siblingLayerViolation(tc.pkg, tc.imp); got != tc.wantLayers {
			t.Errorf("%s: siblingLayerViolation = %v, want %v", tc.name, got, tc.wantLayers)
		}
	}
}
