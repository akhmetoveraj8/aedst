package config_test

import (
	"strings"
	"testing"

	"github.com/aedst/server/internal/platform/config"
)

func TestConfig_ValidateClientCapabilities(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*config.Config)
		wantErr string
	}{
		{"recommended at or above the minimum", func(c *config.Config) {
			c.Client.MinVersions = map[string]string{"android": "1.2.0"}
			c.Client.RecommendedVersions = map[string]string{"android": "1.2.0", "web": "3.0.0"}
		}, ""},
		{"recommended below the minimum", func(c *config.Config) {
			c.Client.MinVersions = map[string]string{"android": "1.2.0"}
			c.Client.RecommendedVersions = map[string]string{"android": "1.1.0"}
		}, "below the minimum"},
		{"unknown platform in recommended", func(c *config.Config) {
			c.Client.RecommendedVersions = map[string]string{"toaster": "1.0.0"}
		}, "AEDST_RECOMMENDED_CLIENT_VERSIONS: unknown platform"},
		{"malformed recommended version", func(c *config.Config) {
			c.Client.RecommendedVersions = map[string]string{"web": "soon"}
		}, "AEDST_RECOMMENDED_CLIENT_VERSIONS"},
		{"valid features", func(c *config.Config) {
			c.Client.FeaturesJSON = `{"new_search":{"enabled":true,"params":{"rollout_percent":"25"}},"beta":{"enabled":false}}`
		}, ""},
		{"features not json", func(c *config.Config) { c.Client.FeaturesJSON = `new_search=true` }, "AEDST_FEATURES"},
		{"features with unknown field", func(c *config.Config) {
			c.Client.FeaturesJSON = `{"x":{"enabled":true,"rollout":5}}`
		}, "AEDST_FEATURES"},
		{"feature name with a dot is reserved for derived capabilities", func(c *config.Config) {
			c.Client.FeaturesJSON = `{"media.uploads":{"enabled":true}}`
		}, "feature name"},
		{"feature name in upper case", func(c *config.Config) { c.Client.FeaturesJSON = `{"NewSearch":{"enabled":true}}` }, "feature name"},
		{"param value too long", func(c *config.Config) {
			c.Client.FeaturesJSON = `{"x":{"enabled":true,"params":{"k":"` + strings.Repeat("v", 300) + `"}}}`
		}, "oversized"},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			cfg := validConfig()
			tc.mutate(&cfg)
			err := cfg.Validate()
			switch {
			case tc.wantErr == "" && err != nil:
				t.Fatalf("Validate() = %v, want valid", err)
			case tc.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tc.wantErr)):
				t.Fatalf("Validate() = %v, want an error containing %q", err, tc.wantErr)
			}
		})
	}
}

func TestClientConfig_FeaturesParsing(t *testing.T) {
	got, err := config.ClientConfig{FeaturesJSON: `{"a":{"enabled":true,"params":{"k":"v"}}}`}.Features()
	if err != nil || !got["a"].Enabled || got["a"].Params["k"] != "v" {
		t.Fatalf("Features() = %+v, %v", got, err)
	}
	if got, err := (config.ClientConfig{}).Features(); got != nil || err != nil {
		t.Fatalf("empty Features() = %+v, %v, want nothing", got, err)
	}
}

func TestConfig_ValidateReadReplica(t *testing.T) {
	cfg := validConfig()
	cfg.DB.ReadDSN = "postgres://replica"
	if err := cfg.Validate(); err != nil {
		t.Fatalf("distinct read url rejected: %v", err)
	}
	cfg.DB.ReadDSN = cfg.DB.DSN
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "AEDST_DATABASE_READ_URL") {
		t.Fatalf("read url equal to the primary = %v, want an error", err)
	}
	cfg.DB.ReadDSN, cfg.DB.ReadMaxConns = "postgres://replica", -1
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "READ_MAX_CONNS") {
		t.Fatalf("negative read pool = %v, want an error", err)
	}
}

func TestConfig_ValidateFeatureRequiredClientVersion(t *testing.T) {
	cfg := validConfig()
	cfg.Client.FeaturesJSON = `{"x":{"enabled":true,"required_client_version":"1.4.0"}}`
	if err := cfg.Validate(); err != nil {
		t.Fatalf("valid required_client_version rejected: %v", err)
	}
	cfg.Client.FeaturesJSON = `{"x":{"enabled":true,"required_client_version":"soon"}}`
	if err := cfg.Validate(); err == nil || !strings.Contains(err.Error(), "required_client_version") {
		t.Fatalf("Validate() = %v, want a required_client_version error", err)
	}
}
