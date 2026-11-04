package httpserver

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"google.golang.org/protobuf/reflect/protoreflect"
)

// ParseRolePolicy turns the configured form of a role policy — procedure ->
// "role|role|…" (AEDST_ROLE_POLICY) — into the map RoleInterceptor enforces.
func ParseRolePolicy(raw map[string]string) (map[string][]string, error) {
	policy := make(map[string][]string, len(raw))
	var errs []error
	for procedure, spec := range raw {
		var roles []string
		for _, role := range strings.Split(spec, "|") {
			if role = strings.TrimSpace(role); role != "" {
				roles = append(roles, role)
			}
		}
		if len(roles) == 0 {
			errs = append(errs, fmt.Errorf("role policy for %q names no role", procedure))
			continue
		}
		slices.Sort(roles)
		policy[strings.TrimSpace(procedure)] = slices.Compact(roles)
	}
	return policy, errors.Join(errs...)
}

// ProceduresOf lists the full procedure names ("/pkg.Service/Method") of the
// given services, taken from their protobuf descriptors so the list can never
// drift from the API.
func ProceduresOf(files ...protoreflect.FileDescriptor) map[string]bool {
	procedures := map[string]bool{}
	for _, file := range files {
		services := file.Services()
		for i := range services.Len() {
			service := services.Get(i)
			methods := service.Methods()
			for j := range methods.Len() {
				procedures["/"+string(service.FullName())+"/"+string(methods.Get(j).Name())] = true
			}
		}
	}
	return procedures
}

// ValidateRolePolicy rejects a policy that would silently protect nothing: a
// procedure that does not exist (a typo would leave the real RPC open), or a
// public one (which has no identity to check roles against). A service
// wildcard ("/pkg.Service/*") must match at least one known procedure and no
// public one. It runs at startup, so a bad policy fails the deploy instead of
// failing open in production.
func ValidateRolePolicy(policy map[string][]string, known, public map[string]bool) error {
	var errs []error
	for procedure := range policy {
		if prefix, ok := strings.CutSuffix(procedure, "/*"); ok {
			matched := false
			for p := range known {
				if strings.HasPrefix(p, prefix+"/") {
					matched = true
					if public[p] {
						errs = append(errs, fmt.Errorf("role policy %q covers public procedure %q: it has no authenticated caller to check", procedure, p))
					}
				}
			}
			if !matched {
				errs = append(errs, fmt.Errorf("role policy names unknown service %q (services look like /aedst.admin.v1.AdminService/*)", procedure))
			}
			continue
		}
		switch {
		case !known[procedure]:
			errs = append(errs, fmt.Errorf("role policy names unknown procedure %q (procedures look like /aedst.tasks.v1.TasksService/DeleteTask)", procedure))
		case public[procedure]:
			errs = append(errs, fmt.Errorf("role policy names public procedure %q: it has no authenticated caller to check", procedure))
		}
	}
	return errors.Join(errs...)
}

// MergeRolePolicy returns defaults overlaid by configured: an entry in the
// environment replaces the built-in entry for the same key. Built-in defaults
// make sensitive services (AdminService) closed by default, so a deployment
// with an empty AEDST_ROLE_POLICY is not open to every signed-in user.
func MergeRolePolicy(defaults, configured map[string][]string) map[string][]string {
	out := make(map[string][]string, len(defaults)+len(configured))
	for k, v := range defaults {
		out[k] = v
	}
	for k, v := range configured {
		out[k] = v
	}
	return out
}

// requiredRoles resolves the roles for procedure: an exact entry wins over the
// service wildcard.
func requiredRoles(policy map[string][]string, procedure string) ([]string, bool) {
	if roles, ok := policy[procedure]; ok {
		return roles, true
	}
	if i := strings.LastIndexByte(procedure, '/'); i > 0 {
		roles, ok := policy[procedure[:i]+"/*"]
		return roles, ok
	}
	return nil, false
}
