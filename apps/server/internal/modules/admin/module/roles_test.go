package module_test

import (
	"slices"
	"testing"

	adminv1 "github.com/aedst/server/gen/go/aedst/admin/v1"
	"github.com/aedst/server/internal/modules/admin/module"
	"github.com/aedst/server/internal/platform/httpserver"
)

// Every AdminService RPC must be named explicitly, so adding one forces a
// decision about which roles may call it instead of silently inheriting the
// wildcard.
func TestDefaultRolesNameEveryProcedure(t *testing.T) {
	roles := module.DefaultRoles()
	known := httpserver.ProceduresOf(adminv1.File_aedst_admin_v1_admin_proto)
	if err := httpserver.ValidateRolePolicy(roles, known, nil); err != nil {
		t.Fatalf("invalid default role policy: %v", err)
	}
	for procedure := range known {
		if _, ok := roles[procedure]; !ok {
			t.Errorf("%s has no explicit role entry", procedure)
		}
	}
}

func TestDefaultRolesLeastPrivilege(t *testing.T) {
	roles := module.DefaultRoles()
	const service = "/aedst.admin.v1.AdminService/"
	for _, tc := range []struct {
		method string
		allow  []string
		deny   []string
	}{
		{"GetOverview", []string{module.RoleAdmin, module.RoleSupport, module.RoleAuditor}, nil},
		{"ListTasks", []string{module.RoleAdmin, module.RoleSupport}, []string{module.RoleAuditor}},
		{"ListAuditLog", []string{module.RoleAdmin, module.RoleAuditor}, []string{module.RoleSupport}},
		{"DeleteTask", []string{module.RoleAdmin}, []string{module.RoleSupport, module.RoleAuditor}},
		{"BroadcastNotification", []string{module.RoleAdmin}, []string{module.RoleSupport, module.RoleAuditor}},
	} {
		got := roles[service+tc.method]
		for _, r := range tc.allow {
			if !slices.Contains(got, r) {
				t.Errorf("%s: %s must be allowed", tc.method, r)
			}
		}
		for _, r := range tc.deny {
			if slices.Contains(got, r) {
				t.Errorf("%s: %s must be denied", tc.method, r)
			}
		}
	}
	if got := roles[service+"*"]; len(got) != 1 || got[0] != module.RoleAdmin {
		t.Errorf("wildcard must stay admin-only, got %v", got)
	}
}
