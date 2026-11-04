package module

import adminv1connect "github.com/aedst/server/gen/go/aedst/admin/v1/adminv1connect"

// Operator roles as the identity provider issues them. The web admin mirrors
// this table in apps/web/shared/lib/auth/roles.ts; keep both in step.
const (
	// RoleAdmin may do everything, including destructive and outward-facing actions.
	RoleAdmin = "admin"
	// RoleSupport reads operational data (overview, users, tasks) but changes nothing.
	RoleSupport = "support"
	// RoleAuditor reads the overview and the audit log but not user content.
	RoleAuditor = "auditor"
)

// DefaultRoles is the built-in role policy of AdminService. The service
// wildcard keeps every RPC closed to anyone but admin, so a procedure added
// later is closed until it is deliberately opened here. Exact entries win over
// the wildcard and open only the read-only RPCs to the narrower roles.
// AEDST_ROLE_POLICY replaces an entry for the same key.
func DefaultRoles() map[string][]string {
	service := "/" + adminv1connect.AdminServiceName + "/"
	return map[string][]string{
		service + "*":                     {RoleAdmin},
		service + "GetOverview":           {RoleAdmin, RoleSupport, RoleAuditor},
		service + "ListTasks":             {RoleAdmin, RoleSupport},
		service + "ListAuditLog":          {RoleAdmin, RoleAuditor},
		service + "DeleteTask":            {RoleAdmin},
		service + "BroadcastNotification": {RoleAdmin},
	}
}
