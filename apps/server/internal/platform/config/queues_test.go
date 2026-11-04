package config_test

import (
	"testing"

	"github.com/aedst/server/internal/platform/config"
)

// An explicitly empty AEDST_JOBS_QUEUES makes the process insert-only (an API
// replica with workers deployed apart); only an unset variable takes the default.
func TestLoad_EmptyJobsQueuesIsInsertOnly(t *testing.T) {
	t.Setenv("AEDST_DATABASE_URL", "postgres://x")
	t.Setenv("AEDST_OIDC_ISSUER", "http://localhost:8085")
	t.Setenv("AEDST_OIDC_AUDIENCE", "1")
	t.Setenv("AEDST_JOBS_QUEUES", "")
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("Load() error = %v", err)
	}
	if len(cfg.Jobs.Queues) != 0 {
		t.Fatalf("Queues = %v, want empty (insert-only)", cfg.Jobs.Queues)
	}
}
