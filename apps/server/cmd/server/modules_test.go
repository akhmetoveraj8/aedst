package main

import (
	"context"
	"log/slog"
	"net/http"
	"net/http/httptest"
	"os"
	"slices"
	"testing"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"

	capabilitiesv1 "github.com/aedst/server/gen/go/aedst/capabilities/v1"
	capabilitiesv1connect "github.com/aedst/server/gen/go/aedst/capabilities/v1/capabilitiesv1connect"
	"github.com/aedst/server/internal/platform/config"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/platform/modulekit"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

func testApp(t *testing.T, cfg config.Config) *app {
	t.Helper()
	mods, err := modulekit.Ordered()
	if err != nil {
		t.Fatal(err)
	}
	return &app{
		cfg: cfg, clock: sharedtime.Real{}, mods: mods,
		env: &modulekit.Env{Config: cfg, Logger: slog.New(slog.DiscardHandler), Clock: sharedtime.Real{}},
	}
}

// What the binary links is what is on disk: the registry and the module
// directories must be the same set (architecturetest checks the imports; this
// checks what actually registered at run time).
func TestRegistryMatchesModuleDirectories(t *testing.T) {
	entries, err := os.ReadDir("../../internal/modules")
	if err != nil {
		t.Fatal(err)
	}
	var dirs []string
	for _, e := range entries {
		if e.IsDir() {
			dirs = append(dirs, e.Name())
		}
	}
	if got := modulekit.Names(); !slices.Equal(got, dirs) {
		t.Fatalf("registered modules %v, module directories %v", got, dirs)
	}
}

func TestModulesAreOrderedAfterTheirRequirements(t *testing.T) {
	a := testApp(t, config.Config{})
	pos := map[string]int{}
	for i, m := range a.mods {
		pos[m.Name] = i
	}
	for _, m := range a.mods {
		for _, req := range m.Requires {
			if pos[req] > pos[m.Name] {
				t.Errorf("%s is set up before its requirement %s", m.Name, req)
			}
		}
	}
}

// Every service a module mounts must have its descriptor in some module's Files
// (the role policy could not name its procedures otherwise) and the admin
// service must be closed by default.
func TestMountedServicesAreKnownAndAdminIsClosedByDefault(t *testing.T) {
	var cfg config.Config
	a := testApp(t, cfg)
	rpc := modulekit.NewMounter(http.NewServeMux(), nil, nil, 1<<20, true)
	if err := a.mountModules(rpc); err != nil {
		t.Fatal(err)
	}
	public, roles, known := a.rpcSurface()
	if err := rpc.VerifyKnown(known); err != nil {
		t.Fatal(err)
	}
	if got := len(rpc.Services()); got != len(a.mods) {
		t.Errorf("%d services mounted for %d modules: %v", got, len(a.mods), rpc.Services())
	}
	if !public[capabilitiesv1connect.CapabilitiesServiceGetCapabilitiesProcedure] {
		t.Error("GetCapabilities must be public: clients ask before they can sign in")
	}
	if len(roles) == 0 {
		t.Error("no module declared a default role policy: AdminService would be open to every signed-in user")
	}
	if err := httpserver.ValidateRolePolicy(roles, known, public); err != nil {
		t.Errorf("built-in role policy invalid: %v", err)
	}
}

// Capability negotiation end to end through the real mounter and version gate:
// supported clients get the policy and their standing, ancient ones the
// structured upgrade error, anonymous ones the policy without a standing.
func TestCapabilitiesEndToEnd(t *testing.T) {
	var cfg config.Config
	cfg.Client = config.ClientConfig{
		MinVersions:         map[string]string{"android": "1.2.0"},
		RecommendedVersions: map[string]string{"android": "1.4.0"},
		FeaturesJSON:        `{"new_search":{"enabled":true,"required_client_version":"1.5.0","params":{"rollout_percent":"25"}}}`,
	}
	a := testApp(t, cfg)
	gate := httpserver.ClientVersionInterceptor(context.Background(), cfg.Client.MinVersions, cfg.Client.RecommendedVersions, slog.New(slog.DiscardHandler))
	router := http.NewServeMux()
	rpc := modulekit.NewMounter(router, []connect.ServerInterceptor{gate}, nil, 1<<20, true)
	for _, m := range a.mods {
		if m.Name != "capabilities" {
			continue
		}
		if err := m.Setup(context.Background(), a.env); err != nil {
			t.Fatal(err)
		}
		if err := m.Mount(a.env, rpc); err != nil {
			t.Fatal(err)
		}
	}
	srv := httptest.NewServer(router)
	defer srv.Close()
	client := capabilitiesv1connect.NewCapabilitiesServiceClient(connect.NewClient(connecthttp.NewTransport(srv.Client(), srv.URL)))

	get := func(header string) (*capabilitiesv1.GetCapabilitiesResponse, error) {
		ctx, info := connect.NewClientContext(context.Background())
		if header != "" {
			info.RequestHeader().Set(httpserver.ClientHeader, header)
		}
		res, err := client.GetCapabilities(ctx, &capabilitiesv1.GetCapabilitiesRequest{})
		if err != nil {
			return nil, err
		}
		return res, nil
	}

	res, err := get("android/1.3.0")
	if err != nil {
		t.Fatal(err)
	}
	if res.GetUpdateStatus() != capabilitiesv1.UpdateStatus_UPDATE_STATUS_RECOMMENDED {
		t.Errorf("status = %v, want RECOMMENDED", res.GetUpdateStatus())
	}
	if w := res.GetClients()["android"]; w.GetMinimum() != "1.2.0" || w.GetRecommended() != "1.4.0" {
		t.Errorf("android window = %v", w)
	}
	if f := res.GetFeatures()["new_search"]; !f.GetEnabled() || f.GetParams()["rollout_percent"] != "25" {
		t.Errorf("operator flag lost: %v", f)
	}
	if f := res.GetFeatures()["new_search"]; f.GetRequiredClientVersion() != "1.5.0" {
		t.Errorf("required_client_version = %q, want 1.5.0", f.GetRequiredClientVersion())
	}
	if f, ok := res.GetFeatures()["tasks"]; !ok || !f.GetEnabled() {
		t.Errorf("coarse feature tasks = %v (present %v), want enabled", f, ok)
	}
	if f, ok := res.GetFeatures()["media.uploads"]; !ok || f.GetEnabled() {
		t.Errorf("media.uploads = %v (present %v), want present and off without a bucket", f, ok)
	}
	if res.GetServerVersion() == "" {
		t.Error("server_version is empty")
	}

	if res, err = get("android/1.9.0"); err != nil || res.GetUpdateStatus() != capabilitiesv1.UpdateStatus_UPDATE_STATUS_CURRENT {
		t.Errorf("current client: %v, %v", res.GetUpdateStatus(), err)
	}
	if res, err = get(""); err != nil || res.GetUpdateStatus() != capabilitiesv1.UpdateStatus_UPDATE_STATUS_UNSPECIFIED {
		t.Errorf("anonymous client: %v, %v", res.GetUpdateStatus(), err)
	}
	if _, err = get("android/1.0.0"); connect.CodeOf(err) != connect.CodeFailedPrecondition {
		t.Errorf("unsupported client: err = %v, want failed_precondition", err)
	}
}
