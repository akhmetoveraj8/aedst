package module

import (
	"testing"

	"github.com/aedst/server/internal/modules/capabilities/domain"
	"github.com/aedst/server/internal/platform/config"
)

func TestBuildPolicy(t *testing.T) {
	var cfg config.Config
	cfg.Storage.Bucket = "media"
	cfg.Client = config.ClientConfig{
		MinVersions:         map[string]string{"android": "1.2.0"},
		RecommendedVersions: map[string]string{"android": "1.4.0", "web": "2.0.0"},
		FeaturesJSON:        `{"new_search":{"enabled":true,"required_client_version":"v2.0.0","params":{"rollout_percent":"25"}},"beta_ui":{"enabled":false},"search":{"enabled":false}}`,
	}

	p, err := buildPolicy(cfg, "1.9.0", []string{"tasks", "search", "capabilities"})
	if err != nil {
		t.Fatal(err)
	}
	if p.ServerVersion != "1.9.0" {
		t.Errorf("ServerVersion = %q", p.ServerVersion)
	}
	if got := p.Clients["android"]; got != (domain.ClientVersions{Minimum: "1.2.0", Recommended: "1.4.0"}) {
		t.Errorf("android window = %+v", got)
	}
	if got := p.Clients["web"]; got != (domain.ClientVersions{Recommended: "2.0.0"}) {
		t.Errorf("web window = %+v", got)
	}
	for name, want := range map[string]bool{
		"media.uploads":         true,  // bucket configured
		"auth.oidc":             false, // no issuer configured
		"media.image_delivery":  false, // imgproxy off
		"push.fcm":              false,
		"attest.play_integrity": false,
		"new_search":            true,
		"beta_ui":               false,
		"tasks":                 true,  // coarse id: module registered
		"search":                false, // coarse id switched off by AEDST_FEATURES (explicit false wins)
	} {
		f, ok := p.Features[name]
		if !ok || f.Enabled != want {
			t.Errorf("feature %s = %+v (present %v), want enabled=%v", name, f, ok, want)
		}
	}
	if p.Features["new_search"].Params["rollout_percent"] != "25" {
		t.Errorf("params lost: %+v", p.Features["new_search"])
	}
}

func TestBuildPolicy_MalformedFeatures(t *testing.T) {
	var cfg config.Config
	cfg.Client.FeaturesJSON = `{"x":`
	if _, err := buildPolicy(cfg, "dev", nil); err == nil {
		t.Fatal("malformed AEDST_FEATURES must fail")
	}
}

func TestBuildPolicy_CoarseIdsAndRequiredVersion(t *testing.T) {
	var cfg config.Config
	cfg.Client.FeaturesJSON = `{"new_search":{"enabled":true,"required_client_version":"v2.0.0"}}`
	p, err := buildPolicy(cfg, "dev", []string{"tasks", "capabilities"})
	if err != nil {
		t.Fatal(err)
	}
	if f, ok := p.Features["tasks"]; !ok || !f.Enabled || f.RequiredClientVersion != "" {
		t.Errorf("tasks = %+v (present %v), want a plain enabled coarse entry", f, ok)
	}
	if _, ok := p.Features["capabilities"]; ok {
		t.Error("the capabilities module itself is not a client feature")
	}
	if _, ok := p.Features["media"]; ok {
		t.Error("a module that is not registered must not be listed (client falls back to its default)")
	}
	if got := p.Features["new_search"].RequiredClientVersion; got != "2.0.0" {
		t.Errorf("required_client_version = %q, want 2.0.0 (v prefix stripped)", got)
	}
}
