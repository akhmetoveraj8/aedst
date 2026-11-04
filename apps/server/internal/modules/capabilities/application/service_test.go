package application_test

import (
	"context"
	"testing"

	"github.com/aedst/server/internal/modules/capabilities/application"
	"github.com/aedst/server/internal/modules/capabilities/domain"
)

func newService() *application.Service {
	return application.NewService(application.Policy{
		ServerVersion: "1.0.0",
		Clients: map[string]domain.ClientVersions{
			"android": {Minimum: "1.2.0", Recommended: "1.4.0"},
			"web":     {},
		},
		Features: map[string]domain.Feature{"f": {Enabled: true, Params: map[string]string{"k": "v"}}},
	})
}

func TestGet_UpdateStatus(t *testing.T) {
	for name, tc := range map[string]struct {
		platform, version string
		want              domain.UpdateStatus
	}{
		"current":                      {"android", "v1.4.0", domain.StatusCurrent},
		"newer":                        {"android", "v2.0.0", domain.StatusCurrent},
		"below recommended":            {"android", "v1.3.0", domain.StatusRecommended},
		"below minimum is not current": {"android", "v1.1.0", domain.StatusRecommended},
		"semver not lexical":           {"android", "v1.10.0", domain.StatusCurrent},
		"prerelease of recommended":    {"android", "v1.4.0-rc.1", domain.StatusRecommended},
		"platform without a window":    {"web", "v9.0.0", domain.StatusUnknown},
		"unknown platform":             {"toaster", "v1.0.0", domain.StatusUnknown},
		"anonymous":                    {"", "", domain.StatusUnknown},
	} {
		got, err := newService().Get(context.Background(), tc.platform, tc.version)
		if err != nil || got.Status != tc.want {
			t.Errorf("%s: status = %v (err %v), want %v", name, got.Status, err, tc.want)
		}
	}
}

func TestGet_ReturnsPolicyAndACopy(t *testing.T) {
	s := newService()
	got, _ := s.Get(context.Background(), "", "")
	if got.ServerVersion != "1.0.0" || got.Clients["android"].Minimum != "1.2.0" || !got.Features["f"].Enabled {
		t.Fatalf("policy not reflected: %+v", got)
	}
	got.Features["f"].Params["k"] = "changed"
	got.Clients["android"] = domain.ClientVersions{}
	again, _ := s.Get(context.Background(), "", "")
	if again.Features["f"].Params["k"] != "v" || again.Clients["android"].Minimum != "1.2.0" {
		t.Errorf("mutating a result changed the policy: %+v", again)
	}
}
