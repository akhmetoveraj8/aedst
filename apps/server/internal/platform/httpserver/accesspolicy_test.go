package httpserver_test

import (
	"context"
	"strings"
	"testing"

	"connectrpc.com/connect/v2"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/httpserver"
)

// The policy lists alternatives: a role, a scope ("scope:x") or both ("a+scope:x").
// People are authorised by role, machine callers (client credentials) by scope.
func TestRoleInterceptor_RolesAndScopes(t *testing.T) {
	policy, err := httpserver.ParseRolePolicy(map[string]string{
		testProcedure: "admin | scope:tasks.operator | internal+scope:events.ingest",
	})
	if err != nil {
		t.Fatalf("ParseRolePolicy: %v", err)
	}
	ok := func(context.Context) error { return nil }

	tests := []struct {
		name     string
		identity platformauth.Identity
		want     connect.Code
	}{
		{"person with the role", platformauth.Identity{Roles: []string{"admin"}}, 0},
		{"machine with the scope and no role", platformauth.Identity{Scopes: []string{"openid", "tasks.operator"}}, 0},
		{"role and scope together", platformauth.Identity{Roles: []string{"internal"}, Scopes: []string{"events.ingest"}}, 0},
		{"the role of a conjunction alone is not enough", platformauth.Identity{Roles: []string{"internal"}}, connect.CodePermissionDenied},
		{"the scope of a conjunction alone is not enough", platformauth.Identity{Scopes: []string{"events.ingest"}}, connect.CodePermissionDenied},
		{"a role named like the scope does not count", platformauth.Identity{Roles: []string{"tasks.operator", "scope:tasks.operator"}}, connect.CodePermissionDenied},
		{"a scope named like the role does not count", platformauth.Identity{Scopes: []string{"admin"}}, connect.CodePermissionDenied},
		{"nothing", platformauth.Identity{}, connect.CodePermissionDenied},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := serve(t, ok, withIdentity(tt.identity), httpserver.RoleInterceptor(policy))()
			if tt.want == 0 {
				if err != nil {
					t.Fatalf("err = %v, want allowed", err)
				}
				return
			}
			ce, details := detailsOf(t, err)
			if ce.Code() != tt.want {
				t.Fatalf("code = %v, want %v", ce.Code(), tt.want)
			}
			if details.info.GetReason() != httpserver.ReasonInsufficientScope ||
				details.info.GetMetadata()["required_scopes"] != "events.ingest tasks.operator" {
				t.Errorf("ErrorInfo = %v, want INSUFFICIENT_SCOPE naming the scopes", details.info)
			}
		})
	}

	// A roles-only policy keeps its old answer.
	_, details := detailsOf(t, serve(t, ok, withIdentity(platformauth.Identity{}),
		httpserver.RoleInterceptor(map[string][]string{testProcedure: {"admin"}}))())
	if details.info.GetReason() != httpserver.ReasonPermissionDenied {
		t.Errorf("roles-only denial reason = %v", details.info)
	}
}

// A malformed entry must fail the deploy (startup validation), and if one ever
// reaches the interceptor the procedure is closed, never open.
func TestParseRolePolicy_RejectsMalformedScopeEntries(t *testing.T) {
	for _, spec := range []string{"scope:", "admin+", "+scope:x", "admin|scope: ", "scope:a b", "admin++support"} {
		_, err := httpserver.ParseRolePolicy(map[string]string{"/a.v1.S/Do": spec})
		if err == nil || !strings.Contains(err.Error(), "/a.v1.S/Do") {
			t.Errorf("ParseRolePolicy(%q) = %v, want an error naming the procedure", spec, err)
		}
	}
	// The pre-scope format is unchanged.
	policy, err := httpserver.ParseRolePolicy(map[string]string{"/a.v1.S/Do": "support|admin"})
	if err != nil || strings.Join(policy["/a.v1.S/Do"], ",") != "admin,support" {
		t.Fatalf("roles-only policy = %v, %v", policy, err)
	}

	closed := httpserver.RoleInterceptor(map[string][]string{testProcedure: {"scope:"}})
	err = serve(t, func(context.Context) error { return nil },
		withIdentity(platformauth.Identity{Roles: []string{"admin"}, Scopes: []string{""}}), closed)()
	if connect.CodeOf(err) != connect.CodePermissionDenied {
		t.Fatalf("unparsable policy entry: err = %v, want the procedure closed", err)
	}
}
