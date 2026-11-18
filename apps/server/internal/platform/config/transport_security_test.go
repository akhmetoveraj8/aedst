package config_test

import (
	"strings"
	"testing"

	"github.com/aedst/server/internal/platform/config"
)

func TestValidate_TransportSecurityInDeployedEnvironments(t *testing.T) {
	prod := func(mutate func(*config.Config)) error {
		c := validConfig()
		c.Env = config.EnvProduction
		c.OIDC = config.OIDCConfig{Issuer: "https://idp.example.com", Audience: "aud", Algorithms: []string{"RS256"}}
		mutate(&c)
		return c.Validate()
	}
	tests := []struct {
		name    string
		mutate  func(*config.Config)
		wantErr string
	}{
		{"verified TLS everywhere", func(*config.Config) {}, ""},
		{"cache plaintext", func(c *config.Config) { c.Cache.TLS = false }, "AEDST_CACHE_TLS"},
		{"cache plaintext, explicit opt-out", func(c *config.Config) { c.Cache.TLS = false; c.Cache.AllowPlaintext = true }, ""},
		{"sslmode=require is encrypted but unverified", func(c *config.Config) { c.DB.DSN = "postgres://x?sslmode=require" }, "AEDST_DATABASE_URL"},
		{"no sslmode means prefer", func(c *config.Config) { c.DB.DSN = "postgres://x" }, "AEDST_DATABASE_URL"},
		{"verify-ca is accepted", func(c *config.Config) { c.DB.DSN = "postgres://x?sslmode=verify-ca" }, ""},
		{"keyword/value DSN", func(c *config.Config) { c.DB.DSN = "host=db user=a sslmode=disable" }, "AEDST_DATABASE_URL"},
		{"keyword/value DSN verified", func(c *config.Config) { c.DB.DSN = "host=db user=a sslmode=verify-full" }, ""},
		{"direct DSN is checked too", func(c *config.Config) { c.DB.DirectDSN = "postgres://x?sslmode=disable" }, "AEDST_DATABASE_DIRECT_DSN"},
		{"module database is checked too", func(c *config.Config) {
			c.DB.Modules = map[string]config.ModuleDatabase{"integrity": {DSN: "postgres://x?sslmode=disable"}}
		}, "AEDST_DATABASE_URL_INTEGRITY"},
		{"explicit opt-out", func(c *config.Config) { c.DB.DSN = "postgres://x?sslmode=disable"; c.DB.AllowUnverifiedTLS = true }, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			err := prod(tt.mutate)
			switch {
			case tt.wantErr == "" && err != nil:
				t.Fatalf("Validate() = %v, want nil", err)
			case tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)):
				t.Fatalf("Validate() = %v, want error containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestValidate_DevelopmentKeepsPlainConnections(t *testing.T) {
	c := validConfig()
	c.Cache.TLS = false
	c.DB.DSN = "postgres://aedst:aedst@localhost:5432/aedst?sslmode=disable"
	if err := c.Validate(); err != nil {
		t.Fatalf("development must keep working locally: %v", err)
	}
}

func TestValidate_AuditRetentionRespectsTheDatabaseFloor(t *testing.T) {
	c := validConfig()
	c.Retention.AuditDays = config.MinAuditRetentionDays - 1
	if err := c.Validate(); err == nil || !strings.Contains(err.Error(), "AEDST_RETENTION_AUDIT_DAYS") {
		t.Fatalf("Validate() = %v, want the audit retention floor", err)
	}
	c.Retention.AuditDays = config.MinAuditRetentionDays
	if err := c.Validate(); err != nil {
		t.Fatalf("the floor itself is valid: %v", err)
	}
}

func TestLoad_LegacyValkeyEnvIsHonoured(t *testing.T) {
	t.Setenv("AEDST_DATABASE_URL", "postgres://x?sslmode=verify-full")
	t.Setenv("AEDST_OIDC_ISSUER", "https://idp.example")
	t.Setenv("AEDST_OIDC_AUDIENCE", "api")
	t.Setenv("AEDST_VALKEY_ADDR", "old:6379")
	t.Setenv("AEDST_CACHE_DB", "3")
	t.Setenv("AEDST_VALKEY_DB", "9") // the new name wins
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load: %v", err)
	}
	if cfg.Cache.Addr != "old:6379" || cfg.Cache.DB != 3 {
		t.Fatalf("Cache = %+v; want legacy addr honoured and new DB winning", cfg.Cache)
	}
}
