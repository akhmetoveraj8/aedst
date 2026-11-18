package module

import (
	"slices"
	"testing"

	notificationsv1connect "github.com/aedst/server/gen/go/aedst/notifications/v1/notificationsv1connect"
)

// The operator service is closed by default: the wildcard admits only admin and the
// service identity; the device count is opened to the read-only operator roles that
// already see it in admin's overview. Broadcasting stays admin/internal-only.
func TestOperatorRoles(t *testing.T) {
	roles := operatorRoles()
	service := "/" + notificationsv1connect.NotificationsOperatorServiceName + "/"

	if got := roles[service+"*"]; !slices.Equal(got, []string{roleAdmin, roleInternal}) {
		t.Errorf("wildcard = %v, want admin and internal only", got)
	}
	if got := roles[service+"OperatorBroadcast"]; slices.Contains(got, roleSupport) || slices.Contains(got, roleAuditor) || !slices.Contains(got, roleInternal) {
		t.Errorf("OperatorBroadcast = %v", got)
	}
	if got := roles[service+"CountAllActiveDevices"]; !slices.Contains(got, roleAuditor) || !slices.Contains(got, roleSupport) {
		t.Errorf("CountAllActiveDevices = %v", got)
	}
}
