package modulekit

import (
	"fmt"
	"slices"
	"sort"
	"strings"
)

// A unit is anything registered with Register: a module ("chat") or a feature of
// one ("social/like"). Every unit has the same shape (an api/ contract, its own
// schema, events, a module/ registration), which is what lets any unit be hosted
// in this process or reached over the network without its callers changing.

// Parent returns the module a feature unit belongs to ("social" for
// "social/like"), or "" for a module.
func Parent(name string) string {
	parent, _, ok := strings.Cut(name, "/")
	if !ok {
		return ""
	}
	return parent
}

// Plan is the topology of one process: the units it hosts and the units it
// reaches over the network.
type Plan struct {
	// Local are the hosted units, every unit after the units it requires.
	Local []Module
	// Remote are the required units that live elsewhere. Their Remote hook runs
	// before any Local Setup, so Require resolves to a network client.
	Remote []Module
	// Others are all registered units this process does not host, Remote ones
	// included. Their Consumes feed the event catalog (Registry.SubscribeRemote).
	Others []Module
}

// Select computes the Plan for the registry. enabled is AEDST_MODULES (empty =
// every registered unit) and remoteURLs is AEDST_MODULE_<NAME>_URL.
func Select(enabled []string, remoteURLs map[string]string) (Plan, error) {
	mu.Lock()
	defer mu.Unlock()
	return selectUnits(registry, enabled, remoteURLs)
}

func selectUnits(all map[string]Module, enabled []string, remoteURLs map[string]string) (Plan, error) {
	known := sortedNames(all)
	for name := range remoteURLs {
		m, ok := all[name]
		switch {
		case !ok:
			return Plan{}, fmt.Errorf("modulekit: AEDST_MODULE_%s_URL names no registered unit; registered: %v", envName(name), known)
		case m.Remote == nil:
			return Plan{}, fmt.Errorf("modulekit: unit %q has no Remote hook, so it cannot be reached over the network: only units whose api/ is network-safe declare one", name)
		}
	}

	local := map[string]Module{}
	if len(enabled) == 0 {
		for name, m := range all {
			if _, remote := remoteURLs[name]; !remote {
				local[name] = m
			}
		}
	}
	for _, want := range enabled {
		matched := false
		for name, m := range all {
			// A module enables its features; a feature enables only itself.
			if name == want || Parent(name) == want {
				local[name] = m
				matched = true
			}
		}
		if !matched {
			return Plan{}, fmt.Errorf("modulekit: AEDST_MODULES names %q, which is not registered; registered: %v", want, known)
		}
	}
	for name := range remoteURLs {
		if _, both := local[name]; both {
			return Plan{}, fmt.Errorf("modulekit: unit %q is hosted here and has a remote URL: pick one", name)
		}
	}

	remote := map[string]Module{}
	for _, name := range sortedNames(local) {
		for _, req := range local[name].Requires {
			if _, ok := local[req]; ok {
				continue
			}
			if _, ok := remoteURLs[req]; ok {
				remote[req] = all[req]
				continue
			}
			if _, registered := all[req]; !registered {
				return Plan{}, fmt.Errorf("modulekit: unit %q requires %q, which is not registered (is its module package imported in cmd/server/modules.go?)", name, req)
			}
			return Plan{}, fmt.Errorf("modulekit: unit %q requires %q, which is neither hosted here (add it to AEDST_MODULES) nor reachable (set AEDST_MODULE_%s_URL)", name, req, envName(req))
		}
	}

	ordered, err := order(local, remote)
	if err != nil {
		return Plan{}, err
	}
	rem := make([]Module, 0, len(remote))
	for _, name := range sortedNames(remote) {
		rem = append(rem, remote[name])
	}
	var others []Module
	for _, name := range sortedNames(all) {
		if _, hosted := local[name]; !hosted {
			others = append(others, all[name])
		}
	}
	return Plan{Local: ordered, Remote: rem, Others: others}, nil
}

func sortedNames(m map[string]Module) []string {
	names := make([]string, 0, len(m))
	for n := range m {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// envName is the AEDST_MODULE_<NAME>_URL spelling of a unit name.
func envName(unit string) string {
	return strings.ToUpper(strings.ReplaceAll(unit, "/", "__"))
}

// Hosts reports whether the plan runs unit name in this process.
func (p Plan) Hosts(name string) bool {
	return slices.ContainsFunc(p.Local, func(m Module) bool { return m.Name == name })
}

// Names returns the hosted unit names in setup order.
func (p Plan) Names() []string {
	out := make([]string, len(p.Local))
	for i, m := range p.Local {
		out[i] = m.Name
	}
	return out
}
