package module

import notificationsv1connect "github.com/aedst/server/gen/go/aedst/notifications/v1/notificationsv1connect"

// Role names the identity provider issues. "admin" is a human operator (the admin
// module forwards their token for reads); "internal" is the machine identity of
// the admin.apply job (for mutations).
const (
	roleAdmin    = "admin"
	roleSupport  = "support"
	roleAuditor  = "auditor"
	roleInternal = "internal"
)

// operatorRoles is the built-in role policy of NotificationsOperatorService:
// closed by default (the wildcard), the device count opened to the read-only
// operator roles that already see it in admin's overview. AEDST_ROLE_POLICY
// replaces an entry for the same key.
func operatorRoles() map[string][]string {
	service := "/" + notificationsv1connect.NotificationsOperatorServiceName + "/"
	return map[string][]string{
		service + "*":                     {roleAdmin, roleInternal},
		service + "CountAllActiveDevices": {roleAdmin, roleSupport, roleAuditor, roleInternal},
		service + "OperatorBroadcast":     {roleAdmin, roleInternal},
	}
}
