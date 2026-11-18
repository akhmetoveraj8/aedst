package config

import (
	"fmt"
	"net/url"
	"slices"
	"sort"
	"strings"
)

// TopologyConfig says which registered units run in this process and where the
// others live. It is what makes a unit location-transparent: the same binary
// runs the whole monolith (nothing set), one service (AEDST_MODULES=chat) or a
// service that reaches a neighbour over the network
// (AEDST_MODULE_AUTH_URL=https://auth.internal).
type TopologyConfig struct {
	// Enabled is AEDST_MODULES: the comma-separated units this process hosts.
	// Empty means every registered unit (the monolith). A unit is a module
	// ("chat") or a feature of one ("social/like"); naming a module enables its
	// features, naming a feature enables only that feature.
	Enabled []string `env:"AEDST_MODULES" envSeparator:","`
	// Remote is AEDST_MODULE_<NAME>_URL: the base URL of a unit that is not hosted
	// here. "/" in a feature name is written "__" (AEDST_MODULE_SOCIAL__LIKE_URL).
	// Filled by Load, see topology.go.
	Remote map[string]string `env:"-"`
}

const (
	moduleURLPrefix = "AEDST_MODULE_"
	moduleURLSuffix = "_URL"
)

// remoteUnits reads AEDST_MODULE_<NAME>_URL overrides from environ ("KEY=value"
// strings). Names are lower-cased and "__" becomes "/", so a feature is
// addressable. Like the per-module database overrides they are open-ended on
// purpose, so they are not `env:` tags; wiring rejects an unknown name.
func remoteUnits(environ []string) map[string]string {
	out := map[string]string{}
	for _, kv := range environ {
		key, val, ok := strings.Cut(kv, "=")
		if !ok || val == "" || !strings.HasPrefix(key, moduleURLPrefix) || !strings.HasSuffix(key, moduleURLSuffix) {
			continue
		}
		name := strings.TrimSuffix(strings.TrimPrefix(key, moduleURLPrefix), moduleURLSuffix)
		name = strings.ReplaceAll(strings.ToLower(name), "__", "/")
		if name == "" {
			continue
		}
		out[name] = val
	}
	return out
}

// Validate checks the shape of the topology: names are plain unit names and
// every remote URL is an absolute http(s) URL. Whether the names are
// registered, and whether a missing neighbour is reachable, is checked against
// the registry by modulekit.Select.
func (t TopologyConfig) Validate() error {
	var errs []string
	for _, n := range t.Enabled {
		if !ValidUnitName(n) {
			errs = append(errs, fmt.Sprintf("AEDST_MODULES: %q is not a unit name (lower-case letters, digits, '_' and one '/' for a feature)", n))
		}
	}
	for n, raw := range t.Remote {
		if !ValidUnitName(n) {
			errs = append(errs, fmt.Sprintf("%s%s%s: %q is not a unit name", moduleURLPrefix, strings.ToUpper(n), moduleURLSuffix, n))
			continue
		}
		u, err := url.Parse(raw)
		if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
			errs = append(errs, fmt.Sprintf("%s%s%s must be an absolute http(s) URL", moduleURLPrefix, strings.ToUpper(strings.ReplaceAll(n, "/", "__")), moduleURLSuffix))
		}
		if slices.Contains(t.Enabled, n) {
			errs = append(errs, fmt.Sprintf("unit %q is both hosted here (AEDST_MODULES) and remote (a URL is set): pick one", n))
		}
	}
	if len(errs) == 0 {
		return nil
	}
	sort.Strings(errs)
	return fmt.Errorf("topology: %s", strings.Join(errs, "; "))
}

// ValidUnitName reports whether s is a module name ("chat") or a feature name
// ("social/like"): lower-case letters, digits and underscores, at most one '/'.
func ValidUnitName(s string) bool {
	module, feature, isFeature := strings.Cut(s, "/")
	if !validSegment(module) {
		return false
	}
	return !isFeature || validSegment(feature)
}

func validSegment(s string) bool {
	if s == "" || s[0] == '_' || s[len(s)-1] == '_' {
		return false
	}
	for _, r := range s {
		if (r < 'a' || r > 'z') && (r < '0' || r > '9') && r != '_' {
			return false
		}
	}
	return true
}
