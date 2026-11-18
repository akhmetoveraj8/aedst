package module

import tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"

// Roles that may call TasksOperatorService. "admin", "support" and "auditor" are
// the human operator roles of the identity provider (the admin module forwards the
// operator's token for reads); "internal" is the machine identity of the
// admin.apply job. Both strings are the role names the IdP issues.
const (
	roleAdmin    = "admin"
	roleSupport  = "support"
	roleAuditor  = "auditor"
	roleInternal = "internal"
)

// operatorRoles is the built-in role policy of TasksOperatorService: closed by
// default (the wildcard), reads opened to the read-only operator roles. A
// procedure added later stays admin/internal-only until opened here.
// AEDST_ROLE_POLICY replaces an entry for the same key.
func operatorRoles() map[string][]string {
	service := "/" + tasksv1connect.TasksOperatorServiceName + "/"
	return map[string][]string{
		service + "*":                  {roleAdmin, roleInternal},
		service + "ListAllTasks":       {roleAdmin, roleSupport, roleInternal},
		service + "GetAllTaskStats":    {roleAdmin, roleSupport, roleAuditor, roleInternal},
		service + "OperatorDeleteTask": {roleAdmin, roleInternal},
	}
}
