package config

import (
	"fmt"
	"slices"
	"sort"
	"strings"
)

// ModuleDatabase points one module at its own database (database-per-module,
// the first step of extracting it into a service). Empty fields fall back to
// the shared pools.
type ModuleDatabase struct {
	// DSN is AEDST_DATABASE_URL_<MODULE>: the module's request pool.
	DSN string
	// JobsDSN is AEDST_DATABASE_URL_<MODULE>_JOBS: its background pool (River
	// handlers, retention). Empty = DSN when DSN is set, else the shared jobs pool.
	JobsDSN string
}

const moduleDatabasePrefix = "AEDST_DATABASE_URL_"

// moduleDatabases reads AEDST_DATABASE_URL_<MODULE>[_JOBS] overrides from environ
// ("KEY=value" strings). Module names are lower-cased. They are open-ended on
// purpose (any module may be split out), so they are not `env:` tags; wiring
// rejects a name that is not a registered module.
func moduleDatabases(environ []string) map[string]ModuleDatabase {
	out := map[string]ModuleDatabase{}
	for _, kv := range environ {
		key, val, ok := strings.Cut(kv, "=")
		if !ok || val == "" || !strings.HasPrefix(key, moduleDatabasePrefix) {
			continue
		}
		name := strings.TrimPrefix(key, moduleDatabasePrefix)
		jobs := strings.HasSuffix(name, "_JOBS")
		name = strings.ToLower(strings.TrimSuffix(name, "_JOBS"))
		if name == "" {
			continue
		}
		m := out[name]
		if jobs {
			m.JobsDSN = val
		} else {
			m.DSN = val
		}
		out[name] = m
	}
	return out
}

// ValidateModuleDatabases fails when an override names a module that is not
// registered (a typo would otherwise silently keep the shared database).
func (c Config) ValidateModuleDatabases(known []string) error {
	var unknown []string
	for name := range c.DB.Modules {
		if !slices.Contains(known, name) {
			unknown = append(unknown, name)
		}
	}
	if len(unknown) == 0 {
		return nil
	}
	sort.Strings(unknown)
	return fmt.Errorf("config: %s<MODULE> names unknown module(s) %v; registered: %v", moduleDatabasePrefix, unknown, known)
}
