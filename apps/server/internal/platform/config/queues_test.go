package config_test

import (
	"testing"

	"github.com/aedst/server/internal/platform/config"
	"github.com/aedst/server/internal/platform/events"
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

// The config copy of the event-queue rule must be the events package's rule.
func TestIsEventQueueMatchesTheEventsPackage(t *testing.T) {
	for _, name := range []string{"events_notifications", "events_social_like", "default", "media", "events_", "events__x", "events_X", "events_a-b", "events"} {
		if got, want := config.IsEventQueue(name), events.IsQueue(name); got != want {
			t.Errorf("IsEventQueue(%q) = %v, events.IsQueue = %v", name, got, want)
		}
	}
}

func TestValidate_EventQueuesAndWorkers(t *testing.T) {
	base := func() config.Config {
		t.Setenv("AEDST_DATABASE_URL", "postgres://x")
		t.Setenv("AEDST_OIDC_ISSUER", "http://localhost:8085")
		t.Setenv("AEDST_OIDC_AUDIENCE", "1")
		c, err := config.Load()
		if err != nil {
			t.Fatal(err)
		}
		return c
	}
	t.Run("default event workers", func(t *testing.T) {
		if c := base(); c.Jobs.EventWorkers != 10 {
			t.Fatalf("EventWorkers = %d, want 10", c.Jobs.EventWorkers)
		}
	})
	t.Run("an events queue may be listed", func(t *testing.T) {
		c := base()
		c.Jobs.Queues = map[string]int{"events_notifications": 5}
		if err := c.Validate(); err != nil {
			t.Fatalf("Validate() = %v", err)
		}
	})
	t.Run("an unknown queue is still refused", func(t *testing.T) {
		c := base()
		c.Jobs.Queues = map[string]int{"events.notifications": 5, "bogus": 1}
		if err := c.Validate(); err == nil {
			t.Fatal("Validate() = nil for unknown queues")
		}
	})
	t.Run("event workers must not be negative", func(t *testing.T) {
		c := base()
		c.Jobs.EventWorkers = -1
		if err := c.Validate(); err == nil {
			t.Fatal("Validate() = nil for AEDST_JOBS_EVENT_WORKERS=-1")
		}
	})
}
