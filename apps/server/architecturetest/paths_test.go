package architecturetest

import (
	"fmt"
	"strings"
)

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
// module's own packages or one of its features (modules/<m>/features/<f>/...);
// for a feature package the layer is relative to the feature directory.
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

// featuresDir is the directory under a module that holds its features.
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

// featureOf returns the feature a package belongs to ("transfer" for
// modules/wallet/features/transfer/...), "" for a module-level package and
// outside modules.
func featureOf(pkgPath string) string {
	unit := unitOf(pkgPath)
	if _, feature, ok := strings.Cut(unit, "/"); ok {
		return feature
	}
	return ""
}
