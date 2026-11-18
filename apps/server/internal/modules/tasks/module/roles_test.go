package module

import (
	"slices"
	"testing"

	tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"
)

// The operator service is closed by default: the wildcard admits only admin and the
// service identity, and the narrower human roles are opened for reads one by one.
func TestOperatorRoles(t *testing.T) {
	roles := operatorRoles()
	service := "/" + tasksv1connect.TasksOperatorServiceName + "/"

	if got := roles[service+"*"]; !slices.Equal(got, []string{roleAdmin, roleInternal}) {
		t.Errorf("wildcard = %v, want admin and internal only", got)
	}
	for _, proc := range []string{"OperatorDeleteTask"} {
		if slices.Contains(roles[service+proc], roleSupport) || slices.Contains(roles[service+proc], roleAuditor) {
			t.Errorf("%s is open to a read-only role: %v", proc, roles[service+proc])
		}
		if !slices.Contains(roles[service+proc], roleInternal) {
			t.Errorf("%s must be callable by the service identity: %v", proc, roles[service+proc])
		}
	}
	if !slices.Contains(roles[service+"ListAllTasks"], roleSupport) || slices.Contains(roles[service+"ListAllTasks"], roleAuditor) {
		t.Errorf("ListAllTasks = %v: support reads tasks, auditor does not (same as admin.ListTasks)", roles[service+"ListAllTasks"])
	}
	// Every procedure of the service has an explicit entry, so a new RPC cannot ride on a wildcard unnoticed.
	for _, proc := range []string{"ListAllTasks", "GetAllTaskStats", "OperatorDeleteTask"} {
		if _, ok := roles[service+proc]; !ok {
			t.Errorf("%s has no explicit role entry", proc)
		}
	}
}
