// Package architecturetest statically enforces the module boundary rules
// documented in docs/content/server/architecture.md and docs/content/decisions/0006-module-boundaries.md.
// A violation here means a module extraction (docs/content/server/architecture.md#extraction-path)
// would no longer be a mechanical move — this test exists to keep that
// property true, so it must run in CI on every change.
package architecturetest

import (
	"fmt"
	"os"
	"path/filepath"
	"strings"
	"testing"

	"golang.org/x/tools/go/packages"
)

const (
	modulePrefix   = "github.com/aedst/server/internal/modules/"
	platformPrefix = "github.com/aedst/server/internal/platform/"
	cmdPrefix      = "github.com/aedst/server/cmd/"
)

func TestModuleBoundaries(t *testing.T) {
	pkgs := loadPackages(t)

	for _, pkg := range pkgs {
		for _, imp := range pkg.Imports {
			if !crossModuleViolation(pkg.PkgPath, imp.PkgPath) {
				continue // not a module import, own module, the api boundary, or cmd/** -> <module>/module.
			}
			t.Errorf(
				"boundary violation: %s imports %s directly — modules may only depend on another module's api/ package (cmd/** may also import <module>/module; see docs/content/decisions/0006-module-boundaries.md)",
				pkg.PkgPath, imp.PkgPath,
			)
		}
	}
}

// TestDomainDoesNotImportInfrastructure enforces layering within a module:
// domain must never depend on infrastructure (see docs/content/server/modules.md "Module
// internal structure").
func TestDomainDoesNotImportInfrastructure(t *testing.T) {
	pkgs := loadPackages(t)

	for _, pkg := range pkgs {
		module := moduleOf(pkg.PkgPath)
		if module == "" || layerOf(pkg.PkgPath, module) != "domain" {
			continue
		}

		for _, imp := range pkg.Imports {
			if moduleOf(imp.PkgPath) == module && layerOf(imp.PkgPath, module) == "infrastructure" {
				t.Errorf("layering violation: %s (domain) imports %s (infrastructure)", pkg.PkgPath, imp.PkgPath)
			}
		}
	}
}

// forbiddenDependencies are libraries the stack has deliberately ruled out
// (see docs/content/library-first.md). Importing one is a build-breaking
// violation, not a style nit.
var forbiddenDependencies = map[string]string{
	"github.com/go-redsync/redsync":   "no distributed locks in Redis/Valkey — use PostgreSQL advisory locks via internal/platform/lock",
	"github.com/bsm/redislock":        "no distributed locks in Redis/Valkey — use PostgreSQL advisory locks via internal/platform/lock",
	"github.com/golang-jwt/jwt":       "JWT/JOSE goes through lestrrat-go/jwx only (internal/platform/auth)",
	"github.com/dgrijalva/jwt-go":     "JWT/JOSE goes through lestrrat-go/jwx only (internal/platform/auth)",
	"github.com/gin-gonic/gin":        "router is net/http ServeMux (internal/platform/httpserver)",
	"github.com/labstack/echo":        "router is net/http ServeMux (internal/platform/httpserver)",
	"github.com/go-chi/":              "router is net/http ServeMux (owner decision); client IP via internal/platform/clientip (realclientip-go), CORS via rs/cors",
	"github.com/alexedwards/argon2id": "no password hashing: the server stores no credentials (ADR-0019), the OIDC provider owns them",
	"golang.org/x/crypto/argon2":      "no password hashing: the server stores no credentials (ADR-0019), the OIDC provider owns them",
	"golang.org/x/crypto/bcrypt":      "no password hashing: the server stores no credentials (ADR-0019), the OIDC provider owns them",
	"gorm.io/gorm":                    "no ORM — SQL goes through sqlc",
	"github.com/jmoiron/sqlx":         "no ORM/query-builder — SQL goes through sqlc",
	"github.com/minio/minio-go":       "object storage goes through internal/platform/storage (aws-sdk-go-v2 S3 client, s3|minio|r2 presets)",
}

func TestNoForbiddenDependencies(t *testing.T) {
	pkgs := loadPackages(t)

	for _, pkg := range pkgs {
		for path := range pkg.Imports {
			for prefix, why := range forbiddenDependencies {
				if strings.HasPrefix(path, prefix) {
					t.Errorf("forbidden dependency: %s imports %s — %s", pkg.PkgPath, path, why)
				}
			}
		}
	}
}

// TestOnlyValkeyPackageImportsRedisClient keeps the Valkey/Redis client behind
// internal/platform/valkey, so cache and rate-limit consumers depend on
// small interfaces and the backing store stays swappable.
func TestOnlyValkeyPackageImportsRedisClient(t *testing.T) {
	pkgs := loadPackages(t)

	for _, pkg := range pkgs {
		if strings.HasPrefix(pkg.PkgPath, platformPrefix+"valkey") {
			continue
		}
		for path := range pkg.Imports {
			if strings.HasPrefix(path, "github.com/redis/go-redis") || strings.HasPrefix(path, "github.com/go-redis/redis_rate") {
				t.Errorf("boundary violation: %s imports %s directly — only internal/platform/valkey may", pkg.PkgPath, path)
			}
		}
	}
}

// TestOnlyNATSBridgeImportsNATS keeps the NATS client behind
// internal/platform/natsbridge (ADR-0021): everything else publishes through
// events.Publisher. A test may import the embedded server of the same module.
func TestOnlyNATSBridgeImportsNATS(t *testing.T) {
	for _, pkg := range loadPackages(t) {
		if strings.HasPrefix(pkg.PkgPath, platformPrefix+"natsbridge") {
			continue
		}
		for path := range pkg.Imports {
			if strings.HasPrefix(path, "github.com/nats-io/") {
				t.Errorf("boundary violation: %s imports %s directly — only internal/platform/natsbridge may (ADR-0021)", pkg.PkgPath, path)
			}
		}
	}
}

func loadPackages(t *testing.T) []*packages.Package {
	t.Helper()

	cfg := &packages.Config{Mode: packages.NeedName | packages.NeedImports | packages.NeedDeps}
	pkgs, err := packages.Load(cfg, "../internal/...", "../cmd/...")
	if err != nil {
		t.Fatalf("load packages: %v", err)
	}
	if packages.PrintErrors(pkgs) > 0 {
		t.Fatalf("packages failed to load cleanly")
	}
	return pkgs
}

// moduleOf returns the module name ("auth", "users", ...) for a package path
// under internal/modules/, or "" if pkgPath isn't a module package.
func moduleOf(pkgPath string) string {
	if !strings.HasPrefix(pkgPath, modulePrefix) {
		return ""
	}
	rest := strings.TrimPrefix(pkgPath, modulePrefix)
	parts := strings.SplitN(rest, "/", 2)
	return parts[0]
}

// layerOf returns the layer directory of pkgPath within its unit (e.g.
// "domain", "api"), or "" if pkgPath is the unit's root package. A unit is the
// module itself or one of its features (modules/<m>/features/<f>/...); for a
// feature package the layer is relative to the feature directory.
func layerOf(pkgPath, module string) string {
	prefix := fmt.Sprintf("%s%s/", modulePrefix, module)
	if !strings.HasPrefix(pkgPath, prefix) {
		return ""
	}
	parts := strings.Split(strings.TrimPrefix(pkgPath, prefix), "/")
	if parts[0] == featuresDir {
		if len(parts) < 2 {
			return ""
		}
		if len(parts) == 2 { // the feature's root package
			return ""
		}
		return parts[2]
	}
	return parts[0]
}

// featuresDir is the directory under a module that holds its feature units.
const featuresDir = "features"

// unitOf returns the unit a package belongs to: "social" for a module package,
// "social/like" for modules/social/features/like/..., "" outside modules.
func unitOf(pkgPath string) string {
	module := moduleOf(pkgPath)
	if module == "" {
		return ""
	}
	parts := strings.Split(strings.TrimPrefix(pkgPath, modulePrefix+module), "/")
	// parts[0] is "" (the slash after the module), then "features", "<f>", ...
	if len(parts) >= 3 && parts[1] == featuresDir {
		return module + "/" + parts[2]
	}
	return module
}

// TestPlatformDoesNotImportModules keeps the dependency arrow one-way: modules
// depend on platform, never the reverse. (depguard checks the same rule by
// path glob for fast editor feedback; this one resolves real import paths.)
func TestPlatformDoesNotImportModules(t *testing.T) {
	for _, pkg := range loadPackages(t) {
		if !strings.HasPrefix(pkg.PkgPath, platformPrefix) {
			continue
		}
		for path := range pkg.Imports {
			if strings.HasPrefix(path, modulePrefix) {
				t.Errorf("layering violation: platform package %s imports module package %s", pkg.PkgPath, path)
			}
		}
	}
}

// TestEveryModuleHasAPIAndMigrations checks the module template is followed:
// each module under internal/modules exposes a public api/ package (the only
// way other modules may reach it) and owns a migrations/<module> directory.
// A new module that forgets either fails here instead of at extraction time.
func TestEveryModuleHasAPIAndMigrations(t *testing.T) {
	entries, err := os.ReadDir("../internal/modules")
	if err != nil {
		t.Fatalf("read modules: %v", err)
	}
	for _, entry := range entries {
		if !entry.IsDir() {
			continue
		}
		name := entry.Name()
		if info, err := os.Stat(filepath.Join("../internal/modules", name, "api")); err != nil || !info.IsDir() {
			t.Errorf("module %q has no api/ package", name)
		}
		if statelessModules[name] {
			continue
		}
		if info, err := os.Stat(filepath.Join("../migrations", name)); err != nil || !info.IsDir() {
			t.Errorf("module %q has no migrations/%s directory", name, name)
		}
	}
}

// TestOnlyPlatformPackagesImportProviderSDKs keeps vendor SDKs behind their
// platform port: the AWS SDK only in platform/storage, the push libraries
// (webpush-go, Firebase Admin, apns2) only in platform/push. Modules depend
// on the ports.
func TestOnlyPlatformPackagesImportProviderSDKs(t *testing.T) {
	owners := map[string]string{
		"github.com/aws/aws-sdk-go-v2":          platformPrefix + "storage",
		"github.com/aws/smithy-go":              platformPrefix + "storage",
		"github.com/SherClockHolmes/webpush-go": platformPrefix + "push",
		"google.golang.org/api/fcm":             platformPrefix + "push",
		"github.com/sideshow/apns2":             platformPrefix + "push",
		"github.com/grafana/pyroscope-go":       platformPrefix + "observability",
	}
	for _, pkg := range loadPackages(t) {
		for path := range pkg.Imports {
			for prefix, owner := range owners {
				if strings.HasPrefix(path, prefix) && !strings.HasPrefix(pkg.PkgPath, owner) {
					t.Errorf("boundary violation: %s imports %s directly — only %s may", pkg.PkgPath, path, owner)
				}
			}
		}
	}
}

// TestDomainAndApplicationDoNotImportEvents keeps integration-event plumbing in
// the infrastructure layer (ADR-0014): a module's domain and application code
// state business rules and never touch the River-backed event publisher or
// registry, so they stay testable without a database and portable to a
// broker. Producers publish from infrastructure/postgres (inside the
// repository's transaction), consumers subscribe from infrastructure/events.
func TestDomainAndApplicationDoNotImportEvents(t *testing.T) {
	const eventsPkg = platformPrefix + "events"
	for _, pkg := range loadPackages(t) {
		module := moduleOf(pkg.PkgPath)
		if module == "" {
			continue
		}
		if layer := layerOf(pkg.PkgPath, module); layer != "domain" && layer != "application" {
			continue
		}
		for path := range pkg.Imports {
			if path == eventsPkg || strings.HasPrefix(path, eventsPkg+"/") {
				t.Errorf("layering violation: %s imports %s — publish and subscribe from infrastructure/ only (ADR-0014)", pkg.PkgPath, path)
			}
		}
	}
}
