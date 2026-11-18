package config

import (
	"log/slog"
	"strings"
)

const (
	legacyCachePrefix = "AEDST_VALKEY_"
	cachePrefix       = "AEDST_CACHE_"
)

// environment returns the process environment as a map with deprecated names
// resolved: AEDST_VALKEY_<X> is honoured as AEDST_CACHE_<X> when the new name is
// unset. The fallback exists for one release after the Valkey to Dragonfly
// switch (docs/content/decisions/server.md) so an existing deployment keeps
// starting; remove it, and this file, in the next release.
func environment(environ []string, warn func(oldName, newName string)) map[string]string {
	m := make(map[string]string, len(environ))
	for _, kv := range environ {
		if k, v, ok := strings.Cut(kv, "="); ok {
			m[k] = v
		}
	}
	for k, v := range m {
		suffix, ok := strings.CutPrefix(k, legacyCachePrefix)
		if !ok {
			continue
		}
		newName := cachePrefix + suffix
		if _, set := m[newName]; set {
			continue
		}
		m[newName] = v
		warn(k, newName)
	}
	return m
}

func warnDeprecatedEnv(oldName, newName string) {
	slog.Warn("deprecated environment variable; rename it", slog.String("old", oldName), slog.String("new", newName)) //nolint:sloglint // runs before the logger is configured
}
