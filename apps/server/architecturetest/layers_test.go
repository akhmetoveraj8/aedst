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
var expectedModules = []string{"admin", "appattest", "capabilities", "integrity", "media", "notifications", "search", "tasks", "webhooks"}

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
	if featureOf(imp) != "" {
		return true // a feature is internal to its module (see featureViolation)
	}
	layer := layerOf(imp, target)
	if layer == "module" && strings.HasPrefix(pkg, cmdPrefix) {
		return false
	}
	return layer != "api" && layer != ""
}

// siblingLayerViolation reports whether pkg imports a layer that
// forbiddenSiblingLayers forbids for pkg's layer. It applies inside one unit (a
// module's own packages, or one feature's), and from a feature to the shared
// packages of its module: a feature's layer sees the module's api/, domain/ and
// shared infrastructure or transport packages exactly as a module-level package
// of the same layer would (features_test.go covers feature-to-feature imports).
func siblingLayerViolation(pkg, imp string) bool {
	module := moduleOf(pkg)
	if module == "" || moduleOf(imp) != module {
		return false
	}
	sameUnit := unitOf(imp) == unitOf(pkg)
	featureToShared := featureOf(pkg) != "" && featureOf(imp) == ""
	if !sameUnit && !featureToShared {
		return false
	}
	return slices.Contains(forbiddenSiblingLayers[layerOf(pkg, module)], layerOf(imp, module))
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
// internal/platform or any module (a feature's domain may import the shared
// domain of its own module).
func TestDomainImportsOnlyStdlibAndShared(t *testing.T) {
	for _, pkg := range loadPackages(t) {
		module := moduleOf(pkg.PkgPath)
		if module == "" || layerOf(pkg.PkgPath, module) != "domain" {
			continue
		}
		for path := range pkg.Imports {
			if featureOf(pkg.PkgPath) != "" && path == modulePrefix+module+"/domain" {
				continue // a feature's domain builds on its module's shared domain
			}
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
