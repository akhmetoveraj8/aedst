package httpserver

import (
	"context"
	"errors"
	"fmt"
	"slices"
	"strings"

	"connectrpc.com/connect/v2"

	platformauth "github.com/aedst/server/internal/platform/auth"
)

// scopePrefix marks an OAuth scope requirement in the access policy; anything
// without it is a role name.
const scopePrefix = "scope:"

// alternative is one way to be allowed: every listed role and every listed
// scope must be held ("internal+scope:events.ingest").
type alternative struct {
	roles  []string
	scopes []string
}

func (a alternative) allows(identity platformauth.Identity) bool {
	return !slices.ContainsFunc(a.roles, func(r string) bool { return !identity.HasRole(r) }) &&
		!slices.ContainsFunc(a.scopes, func(s string) bool { return !identity.HasScope(s) })
}

// parseAlternative reads "role", "scope:name" or a "+"-joined conjunction of them.
func parseAlternative(spec string) (alternative, error) {
	var alt alternative
	for term := range strings.SplitSeq(spec, "+") {
		term = strings.TrimSpace(term)
		scope, isScope := strings.CutPrefix(term, scopePrefix)
		switch {
		case term == "":
			return alternative{}, fmt.Errorf("%q has an empty requirement (write role, scope:name or role+scope:name)", spec)
		case strings.ContainsAny(term, " \t"):
			return alternative{}, fmt.Errorf("%q: a role or scope name cannot contain spaces", spec)
		case isScope && scope == "":
			return alternative{}, fmt.Errorf("%q names no scope after %q", spec, scopePrefix)
		case isScope:
			alt.scopes = append(alt.scopes, scope)
		default:
			alt.roles = append(alt.roles, term)
		}
	}
	return alt, nil
}

// compilePolicy parses every alternative once. Entries were validated by
// ParseRolePolicy (configuration) or are module defaults (plain role names); a
// malformed one is still an error rather than an open procedure.
func compilePolicy(policy map[string][]string) (map[string][]alternative, error) {
	compiled := make(map[string][]alternative, len(policy))
	var errs []error
	for procedure, specs := range policy {
		for _, spec := range specs {
			alt, err := parseAlternative(spec)
			if err != nil {
				errs = append(errs, fmt.Errorf("access policy for %q: %w", procedure, err))
				continue
			}
			compiled[procedure] = append(compiled[procedure], alt)
		}
	}
	return compiled, errors.Join(errs...)
}

// RoleInterceptor enforces the declarative access policy: policy maps a
// procedure's full name (e.g. "/aedst.admin.v1.AdminService/ListTasks") or a
// service wildcard to alternatives of which the caller must satisfy one. An
// alternative is a role, an OAuth scope ("scope:name", for machine callers that
// authenticate with client credentials) or both joined with "+". Procedures
// absent from policy need only authentication. It must sit after
// AuthInterceptor, which puts the caller's roles and scopes on the context; a
// listed procedure reached without an identity is rejected as unauthenticated
// rather than waved through. A procedure whose policy does not parse is closed
// to everyone (ParseRolePolicy rejects such a policy at startup).
func RoleInterceptor(policy map[string][]string) connect.ServerInterceptor {
	compiled, _ := compilePolicy(policy)
	for procedure := range policy {
		if _, ok := compiled[procedure]; !ok {
			compiled[procedure] = nil // listed but unusable: deny, never open
		}
	}
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			required, restricted := requiredAccess(compiled, spec.Procedure)
			if !restricted {
				return next(ctx, spec, stream)
			}
			identity, ok := platformauth.FromContext(ctx)
			if !ok {
				return connect.NewError(connect.CodeUnauthenticated, msgNoCredential)
			}
			if !slices.ContainsFunc(required, func(a alternative) bool { return a.allows(identity) }) {
				return accessDenied(required)
			}
			return next(ctx, spec, stream)
		}
	}
}

// accessDenied is PERMISSION_DENIED; when a scope would have opened the
// procedure the reason is INSUFFICIENT_SCOPE and names the scopes (RFC 6750
// section 3.1 "insufficient_scope"), so a machine client knows what to request.
func accessDenied(required []alternative) *connect.Error {
	var scopes []string
	for _, alt := range required {
		scopes = append(scopes, alt.scopes...)
	}
	if len(scopes) == 0 {
		return permissionDenied("insufficient role", ReasonPermissionDenied, nil)
	}
	slices.Sort(scopes)
	return permissionDenied("insufficient role or scope", ReasonInsufficientScope,
		map[string]string{"required_scopes": strings.Join(slices.Compact(scopes), " ")})
}

// requiredAccess resolves the alternatives for procedure: an exact entry wins
// over the service wildcard.
func requiredAccess(policy map[string][]alternative, procedure string) ([]alternative, bool) {
	if alts, ok := policy[procedure]; ok {
		return alts, true
	}
	if i := strings.LastIndexByte(procedure, '/'); i > 0 {
		alts, ok := policy[procedure[:i]+"/*"]
		return alts, ok
	}
	return nil, false
}
