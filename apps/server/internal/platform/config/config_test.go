package config_test

import (
	"strings"
	"testing"

	"github.com/aedst/server/internal/platform/config"
)

func validConfig() config.Config {
	return config.Config{
		Env:       config.EnvDevelopment,
		HTTP:      config.HTTPConfig{RequestTimeout: 30, MaxRequestBytes: 1 << 20, AllowedOrigins: []string{"http://localhost:3000"}},
		DB:        config.DatabaseConfig{DSN: "postgres://x?sslmode=verify-full", MaxConns: 20, MinConns: 2, JobsMaxConns: 10},
		Valkey:    config.ValkeyConfig{TLS: true},
		Jobs:      config.JobsConfig{CompletedRetentionHours: 24, CancelledRetentionHours: 24, DiscardedRetentionHours: 168},
		Retention: config.RetentionConfig{IntervalMinutes: 60, IdempotencyHours: 48, TombstoneHours: 336, NotificationDays: 90, AuditDays: 365},
		OIDC:      config.OIDCConfig{Issuer: "https://idp.example", Audience: "api", Algorithms: []string{"RS256"}},
	}
}

func TestConfig_Validate(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*config.Config)
		wantErr string // substring; empty means valid
	}{
		{"valid development", func(*config.Config) {}, ""},
		{"unknown env", func(c *config.Config) { c.Env = "prod" }, "AEDST_ENV"},
		{"wildcard cors in production", func(c *config.Config) { c.Env = config.EnvProduction; c.HTTP.AllowedOrigins = []string{"*"} }, "CORS"},
		{"min conns above max", func(c *config.Config) { c.DB.MinConns = 50 }, "MIN_CONNS"},
		{"jobs pool of one would stall event delivery", func(c *config.Config) { c.DB.JobsMaxConns = 1 }, "JOBS_MAX_CONNS"},
		{"pooler none needs nothing else", func(c *config.Config) { c.DB.Pooler = config.PoolerNone }, ""},
		{"pooler unset behaves as none", func(c *config.Config) { c.DB.Pooler = "" }, ""},
		{"unknown pooler", func(c *config.Config) { c.DB.Pooler = "pgcat" }, "AEDST_DATABASE_POOLER"},
		{"pgbouncer without direct dsn or poll-only", func(c *config.Config) { c.DB.Pooler = config.PoolerPgBouncer }, "AEDST_DATABASE_DIRECT_DSN"},
		{"pgbouncer with direct dsn", func(c *config.Config) {
			c.DB.Pooler = config.PoolerPgBouncer
			c.DB.DirectDSN = "postgres://direct"
		}, ""},
		{"pgbouncer with river poll-only", func(c *config.Config) {
			c.DB.Pooler = config.PoolerPgBouncer
			c.Jobs.PollOnly = true
		}, ""},
		{"completed job retention must be positive", func(c *config.Config) { c.Jobs.CompletedRetentionHours = 0 }, "AEDST_JOBS_COMPLETED_RETENTION_HOURS"},
		{"discarded job retention must be positive", func(c *config.Config) { c.Jobs.DiscardedRetentionHours = 0 }, "AEDST_JOBS_DISCARDED_RETENTION_HOURS"},
		{"retention values must be positive", func(c *config.Config) { c.Retention.IdempotencyHours = 0 }, "AEDST_RETENTION"},
		{"negative api rate limit", func(c *config.Config) { c.HTTP.APIRateLimitPerMinute = -1 }, "AEDST_API_RATE_LIMIT"},
		{"valid min client versions", func(c *config.Config) {
			c.Client.MinVersions = map[string]string{"android": "1.2.0", "web": "2.0.0-rc.1"}
		}, ""},
		{"unknown client platform", func(c *config.Config) { c.Client.MinVersions = map[string]string{"toaster": "1.0.0"} }, "unknown platform"},
		{"malformed client version", func(c *config.Config) { c.Client.MinVersions = map[string]string{"android": "latest"} }, "semantic version"},
		{"oidc issuer is required", func(c *config.Config) { c.OIDC = config.OIDCConfig{} }, "AEDST_OIDC_ISSUER is required"},
		{"oidc without audience", func(c *config.Config) { c.OIDC.Audience = "" }, "AUDIENCE"},
		{"oidc http in production", func(c *config.Config) {
			c.Env = config.EnvProduction
			c.OIDC = config.OIDCConfig{Issuer: "http://idp.example", Audience: "api", Algorithms: []string{"RS256"}}
		}, "https"},
		{"oidc symmetric algorithm", func(c *config.Config) {
			c.OIDC = config.OIDCConfig{Issuer: "https://idp.example", Audience: "api", Algorithms: []string{"HS256"}}
		}, "asymmetric"},
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

// AEDST_MIN_CLIENT_VERSIONS is a comma-separated platform=version list; this
// pins the wire format the Helm chart and .env.example document.
func TestLoad_ParsesMinClientVersionsAndJobRetentionDefaults(t *testing.T) {
	t.Setenv("AEDST_DATABASE_URL", "postgres://x")
	t.Setenv("AEDST_OIDC_ISSUER", "http://localhost:8085")
	t.Setenv("AEDST_OIDC_AUDIENCE", "1")
	t.Setenv("AEDST_MIN_CLIENT_VERSIONS", "web=1.0.0, android=1.2.0")

	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if got := cfg.Client.MinVersions; len(got) != 2 || got["web"] != "1.0.0" || got["android"] != "1.2.0" {
		t.Errorf("MinVersions = %v, want web=1.0.0 android=1.2.0", got)
	}
	if j := cfg.Jobs; j.CompletedRetentionHours != 24 || j.CancelledRetentionHours != 24 || j.DiscardedRetentionHours != 168 {
		t.Errorf("Jobs retention defaults = %+v", j)
	}
	if cfg.DB.JobsMaxConns != 30 || cfg.DB.DirectDSN != "" {
		t.Errorf("DB jobs defaults = %d / %q, want 30 / empty", cfg.DB.JobsMaxConns, cfg.DB.DirectDSN)
	}
}

func TestLoad_PoolerDefaultsAndEnv(t *testing.T) {
	t.Setenv("AEDST_DATABASE_URL", "postgres://x")
	t.Setenv("AEDST_OIDC_ISSUER", "http://localhost:8085")
	t.Setenv("AEDST_OIDC_AUDIENCE", "1")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if cfg.DB.Pooler != config.PoolerNone || cfg.Jobs.PollOnly {
		t.Errorf("defaults = pooler %q poll-only %v, want none/false", cfg.DB.Pooler, cfg.Jobs.PollOnly)
	}

	t.Setenv("AEDST_DATABASE_POOLER", "pgbouncer")
	if _, err := config.Load(); err == nil || !strings.Contains(err.Error(), "AEDST_DATABASE_DIRECT_DSN") {
		t.Fatalf("Load() with pgbouncer only = %v, want direct-dsn/poll-only error", err)
	}
	t.Setenv("AEDST_JOBS_POLL_ONLY", "true")
	if cfg, err = config.Load(); err != nil || !cfg.Jobs.PollOnly {
		t.Fatalf("Load() with poll-only = %+v, %v; want ok", cfg.Jobs, err)
	}
}

func TestLoad_EmptyMinClientVersionsDisablesTheGate(t *testing.T) {
	t.Setenv("AEDST_DATABASE_URL", "postgres://x")
	t.Setenv("AEDST_OIDC_ISSUER", "http://localhost:8085")
	t.Setenv("AEDST_OIDC_AUDIENCE", "1")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(cfg.Client.MinVersions) != 0 {
		t.Errorf("MinVersions = %v, want none", cfg.Client.MinVersions)
	}
}

func TestConfig_ValidateFeatures(t *testing.T) {
	tests := []struct {
		name    string
		mutate  func(*config.Config)
		wantErr string
	}{
		{"write timeout must exceed request timeout", func(c *config.Config) { c.Server.WriteTimeoutSeconds = 30 }, "AEDST_HTTP_WRITE_TIMEOUT_SECONDS"},
		{"tls cert without key", func(c *config.Config) { c.Server.TLSCertFile = "cert.pem" }, "AEDST_TLS_CERT_FILE"},
		{"origin with a path", func(c *config.Config) { c.HTTP.AllowedOrigins = []string{"https://app.example.com/x"} }, "not an origin"},
		{"unknown queue", func(c *config.Config) { c.Jobs.Queues = map[string]int{"emails": 1} }, "unknown queue"},
		{"zero workers", func(c *config.Config) { c.Jobs.Queues = map[string]int{"media": 0} }, "positive worker count"},
		{"bad storage provider", func(c *config.Config) {
			c.Storage = config.StorageConfig{Bucket: "b", Provider: "gcs", UploadURLTTLSeconds: 1, DownloadURLTTLSeconds: 1}
		}, "AEDST_STORAGE_PROVIDER"},
		{"integrity enabled without packages", func(c *config.Config) {
			c.Integrity = config.IntegrityConfig{Enabled: true, MaxTokenAgeSeconds: 300, TimeoutSeconds: 10, MinDeviceLevel: "device"}
		}, "AEDST_INTEGRITY_ALLOWED_PACKAGES"},
		{"integrity bad device level", func(c *config.Config) {
			c.Integrity = config.IntegrityConfig{Enabled: true, AllowedPackages: []string{"a.b"}, MaxTokenAgeSeconds: 300, TimeoutSeconds: 10, MinDeviceLevel: "paranoid"}
		}, "AEDST_INTEGRITY_MIN_DEVICE_LEVEL"},
		{"integrity disabled needs nothing", func(c *config.Config) { c.Integrity = config.IntegrityConfig{MinDeviceLevel: "bogus"} }, ""},
		{"valid integrity", func(c *config.Config) {
			c.Integrity = config.IntegrityConfig{Enabled: true, AllowedPackages: []string{"a.b"}, MaxTokenAgeSeconds: 300, TimeoutSeconds: 10, MinDeviceLevel: "strong"}
		}, ""},
		{"vapid without subject", func(c *config.Config) { c.Push.VAPIDPrivateKey = "k" }, "AEDST_PUSH_VAPID_SUBJECT"},
		{"imgproxy without bucket", func(c *config.Config) {
			c.Imgproxy = config.ImgproxyConfig{Enabled: true, URL: "https://img.example.com", Key: "00ff", Salt: "00ff"}
		}, "AEDST_IMGPROXY_ENABLED requires AEDST_STORAGE_BUCKET"},
		{"imgproxy bad key", func(c *config.Config) {
			c.Storage = config.StorageConfig{Bucket: "b", Provider: "minio", UploadURLTTLSeconds: 1, DownloadURLTTLSeconds: 1}
			c.Imgproxy = config.ImgproxyConfig{Enabled: true, URL: "https://img.example.com", Key: "nothex", Salt: "00ff"}
		}, "AEDST_IMGPROXY_KEY"},
		{"imgproxy relative url", func(c *config.Config) {
			c.Storage = config.StorageConfig{Bucket: "b", Provider: "minio", UploadURLTTLSeconds: 1, DownloadURLTTLSeconds: 1}
			c.Imgproxy = config.ImgproxyConfig{Enabled: true, URL: "img.example.com", Key: "00ff", Salt: "00ff"}
		}, "AEDST_IMGPROXY_URL"},
		{"valid imgproxy", func(c *config.Config) {
			c.Storage = config.StorageConfig{Bucket: "b", Provider: "minio", UploadURLTTLSeconds: 1, DownloadURLTTLSeconds: 1}
			c.Imgproxy = config.ImgproxyConfig{Enabled: true, URL: "https://img.example.com", Key: "00ff", Salt: "00ff", URLTTLSeconds: 3600}
		}, ""},
		{"valid queues and storage", func(c *config.Config) {
			c.Jobs.Queues = map[string]int{"default": 10, "media": 2}
			c.Storage = config.StorageConfig{Bucket: "b", Provider: "minio", UploadURLTTLSeconds: 1, DownloadURLTTLSeconds: 1}
		}, ""},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := validConfig()
			tt.mutate(&cfg)
			err := cfg.Validate()
			if tt.wantErr == "" {
				if err != nil {
					t.Fatalf("Validate() = %v, want nil", err)
				}
				return
			}
			if err == nil || !strings.Contains(err.Error(), tt.wantErr) {
				t.Fatalf("Validate() = %v, want error containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestLoad_RequiresOIDCIssuer(t *testing.T) {
	t.Setenv("AEDST_DATABASE_URL", "postgres://x")
	if _, err := config.Load(); err == nil || !strings.Contains(err.Error(), "AEDST_OIDC_ISSUER") {
		t.Fatalf("Load() without an issuer = %v, want an AEDST_OIDC_ISSUER error", err)
	}
	t.Setenv("AEDST_OIDC_ISSUER", "http://localhost:8085")
	t.Setenv("AEDST_OIDC_AUDIENCE", "1")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() = %v", err)
	}
	if cfg.OIDC.RolesOrg != "" {
		t.Error("AEDST_OIDC_ROLES_ORG must default to empty (any organisation)")
	}
}

func TestLoad_OIDCRolesOrg(t *testing.T) {
	t.Setenv("AEDST_DATABASE_URL", "postgres://x")
	t.Setenv("AEDST_OIDC_ISSUER", "http://localhost:8085")
	t.Setenv("AEDST_OIDC_AUDIENCE", "1")
	t.Setenv("AEDST_OIDC_ROLES_ORG", "312345678901230000")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() = %v", err)
	}
	if cfg.OIDC.RolesOrg != "312345678901230000" {
		t.Errorf("RolesOrg = %q", cfg.OIDC.RolesOrg)
	}
}

func TestLoad_CORSDefaultsCoverAppAndAdminDev(t *testing.T) {
	t.Setenv("AEDST_DATABASE_URL", "postgres://x")
	t.Setenv("AEDST_OIDC_ISSUER", "http://localhost:8085")
	t.Setenv("AEDST_OIDC_AUDIENCE", "1")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() = %v", err)
	}
	want := []string{"http://localhost:3000", "http://localhost:3001"}
	if len(cfg.HTTP.AllowedOrigins) != 2 || cfg.HTTP.AllowedOrigins[0] != want[0] || cfg.HTTP.AllowedOrigins[1] != want[1] {
		t.Errorf("AllowedOrigins = %v, want %v", cfg.HTTP.AllowedOrigins, want)
	}
}
