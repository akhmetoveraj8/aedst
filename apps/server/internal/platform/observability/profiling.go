package observability

import (
	"context"
	"errors"
	"fmt"
	"log/slog"
	"time"
)

// ProfilingConfig configures continuous profiling (AEDST_PROFILING_*). It is
// push-based: the process uploads CPU and heap profiles to a Pyroscope-compatible
// backend (Grafana Cloud Profiles, or any Pyroscope server you already run).
// The server never serves them, so no inbound port is opened; the opt-in pull
// endpoint stays /debug/pprof on AEDST_METRICS_ADDR.
type ProfilingConfig struct {
	Enabled bool
	// ServerAddress is the backend base URL, e.g. https://profiles-prod-001.grafana.net.
	ServerAddress string
	// ApplicationName groups the profiles of one service (default: the service name).
	ApplicationName string
	// BasicAuthUser / BasicAuthPassword authenticate to the backend (Grafana
	// Cloud: the stack's user id and an access-policy token with profiles:write).
	BasicAuthUser     string
	BasicAuthPassword string
	// TenantID is the X-Scope-OrgID of a multi-tenant self-run backend.
	TenantID string
	// Tags are extra labels on every profile (environment, version, ...).
	Tags map[string]string
	// UploadRate is how often a profile is sent; 0 uses the SDK default (15s).
	UploadRate time.Duration
}

// Validate reports a misconfiguration that would silently drop every profile.
func (c ProfilingConfig) Validate() error {
	if c.Enabled && c.ServerAddress == "" {
		return errors.New("observability: profiling enabled without a server address (AEDST_PROFILING_SERVER_ADDRESS)")
	}
	return nil
}

// Profiler is the continuous-profiling port: what the rest of the process may
// do with a running profiler. The Pyroscope SDK is an adapter behind it
// (profiling_pyroscope.go); nothing outside this package imports the vendor.
type Profiler interface {
	// Stop uploads what is buffered and stops sampling.
	Stop(ctx context.Context) error
}

type noopProfiler struct{}

func (noopProfiler) Stop(context.Context) error { return nil }

// StartProfiling starts the configured profiler, or returns a no-op one when
// profiling is disabled.
func StartProfiling(cfg ProfilingConfig, logger *slog.Logger) (Profiler, error) {
	if !cfg.Enabled {
		return noopProfiler{}, nil
	}
	if err := cfg.Validate(); err != nil {
		return nil, err
	}
	p, err := startPyroscope(cfg, logger)
	if err != nil {
		return nil, fmt.Errorf("observability: start profiler: %w", err)
	}
	return p, nil
}
