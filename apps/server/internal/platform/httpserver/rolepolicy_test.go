package httpserver_test

import (
	"strings"
	"testing"

	capabilitiesv1 "github.com/aedst/server/gen/go/aedst/capabilities/v1"
	tasksv1 "github.com/aedst/server/gen/go/aedst/tasks/v1"
	"github.com/aedst/server/internal/platform/httpserver"
)

func TestParseRolePolicy(t *testing.T) {
	policy, err := httpserver.ParseRolePolicy(map[string]string{
		"/a.v1.S/Delete": "support | admin|admin",
		"/a.v1.S/List":   "auditor",
	})
	if err != nil {
		t.Fatalf("ParseRolePolicy: %v", err)
	}
	if got := strings.Join(policy["/a.v1.S/Delete"], ","); got != "admin,support" {
		t.Errorf("roles = %q, want sorted and de-duplicated admin,support", got)
	}
	if got := strings.Join(policy["/a.v1.S/List"], ","); got != "auditor" {
		t.Errorf("roles = %q", got)
	}

	if _, err := httpserver.ParseRolePolicy(map[string]string{"/a.v1.S/Delete": " | "}); err == nil {
		t.Error("a procedure with no role must be rejected, not treated as open")
	}
}

func TestProceduresOfAndValidateRolePolicy(t *testing.T) {
	known := httpserver.ProceduresOf(tasksv1.File_aedst_tasks_v1_tasks_proto, capabilitiesv1.File_aedst_capabilities_v1_capabilities_proto)
	for _, want := range []string{"/aedst.tasks.v1.TasksService/DeleteTask", "/aedst.capabilities.v1.CapabilitiesService/GetCapabilities"} {
		if !known[want] {
			t.Fatalf("procedure %q not derived from the descriptors", want)
		}
	}
	public := map[string]bool{"/aedst.capabilities.v1.CapabilitiesService/GetCapabilities": true}

	if err := httpserver.ValidateRolePolicy(map[string][]string{"/aedst.tasks.v1.TasksService/DeleteTask": {"admin"}}, known, public); err != nil {
		t.Fatalf("a valid policy was rejected: %v", err)
	}
	err := httpserver.ValidateRolePolicy(map[string][]string{
		"/aedst.tasks.v1.TasksService/DeleteTsk":                     {"admin"}, // typo: would leave the real RPC open
		"/aedst.capabilities.v1.CapabilitiesService/GetCapabilities": {"admin"},
	}, known, public)
	if err == nil || !strings.Contains(err.Error(), "unknown procedure") || !strings.Contains(err.Error(), "public procedure") {
		t.Fatalf("ValidateRolePolicy = %v, want both the typo and the public procedure reported", err)
	}
}
