package config_test

import (
	"strings"
	"testing"

	"github.com/aedst/server/internal/platform/config"
)

func TestConfig_ValidateAppAttest(t *testing.T) {
	enabled := func(mutate func(*config.AppAttestConfig)) func(*config.Config) {
		return func(c *config.Config) {
			c.AppAttest = config.AppAttestConfig{
				Enabled: true, TeamID: "ABCDE12345", AllowedBundleIDs: []string{"com.example.app"},
				RateLimitPerMinute: 10, AssertionRateLimitPerMinute: 120, KeyRetentionDays: 365,
			}
			if mutate != nil {
				mutate(&c.AppAttest)
			}
		}
	}
	tests := []struct {
		name    string
		mutate  func(*config.Config)
		wantErr string
	}{
		{"disabled needs nothing", func(c *config.Config) { c.AppAttest = config.AppAttestConfig{TeamID: "bogus"} }, ""},
		{"valid", enabled(nil), ""},
		{"development allowed locally", enabled(func(a *config.AppAttestConfig) { a.AllowDevelopment = true }), ""},
		{"missing team id", enabled(func(a *config.AppAttestConfig) { a.TeamID = "" }), "AEDST_APPATTEST_TEAM_ID"},
		{"lower-case team id", enabled(func(a *config.AppAttestConfig) { a.TeamID = "abcde12345" }), "AEDST_APPATTEST_TEAM_ID"},
		{"no bundle ids", enabled(func(a *config.AppAttestConfig) { a.AllowedBundleIDs = nil }), "AEDST_APPATTEST_ALLOWED_BUNDLE_IDS"},
		{"negative rate limit", enabled(func(a *config.AppAttestConfig) { a.RateLimitPerMinute = -1 }), "AEDST_APPATTEST_*_RATE_LIMIT_PER_MINUTE"},
		{"zero key retention", enabled(func(a *config.AppAttestConfig) { a.KeyRetentionDays = 0 }), "AEDST_APPATTEST_KEY_RETENTION_DAYS"},
		{"development forbidden in production", func(c *config.Config) {
			c.Env = config.EnvProduction
			enabled(func(a *config.AppAttestConfig) { a.AllowDevelopment = true })(c)
		}, "AEDST_APPATTEST_ALLOW_DEVELOPMENT"},
		{"development forbidden in staging", func(c *config.Config) {
			c.Env = config.EnvStaging
			enabled(func(a *config.AppAttestConfig) { a.AllowDevelopment = true })(c)
		}, "AEDST_APPATTEST_ALLOW_DEVELOPMENT"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := validConfig()
			tt.mutate(&cfg)
			err := cfg.Validate()
			switch {
			case tt.wantErr == "" && err != nil:
				t.Fatalf("Validate() = %v, want nil", err)
			case tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)):
				t.Fatalf("Validate() = %v, want error containing %q", err, tt.wantErr)
			}
		})
	}
}
