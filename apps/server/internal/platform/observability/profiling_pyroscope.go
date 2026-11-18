package observability

import (
	"context"
	"fmt"
	"log/slog"

	"github.com/grafana/pyroscope-go"
)

// pyroscopeProfiler adapts the official Grafana Pyroscope Go SDK to Profiler.
type pyroscopeProfiler struct{ p *pyroscope.Profiler }

func startPyroscope(cfg ProfilingConfig, logger *slog.Logger) (Profiler, error) {
	p, err := pyroscope.Start(pyroscope.Config{
		ApplicationName:   cfg.ApplicationName,
		ServerAddress:     cfg.ServerAddress,
		BasicAuthUser:     cfg.BasicAuthUser,
		BasicAuthPassword: cfg.BasicAuthPassword,
		TenantID:          cfg.TenantID,
		Tags:              cfg.Tags,
		UploadRate:        cfg.UploadRate,
		Logger:            slogAdapter{logger: logger},
		// SDK defaults: CPU plus alloc/inuse objects and space. Mutex and block
		// profiles need runtime.SetMutexProfileFraction / SetBlockProfileRate,
		// which cost throughput; enable them deliberately when chasing contention.
	})
	if err != nil {
		return nil, fmt.Errorf("pyroscope: %w", err)
	}
	return pyroscopeProfiler{p: p}, nil
}

func (a pyroscopeProfiler) Stop(context.Context) error { return a.p.Stop() }

// slogAdapter routes the SDK's own messages into the process logger. The SDK's
// logger interface takes no context, so the records carry none.
type slogAdapter struct{ logger *slog.Logger }

func (s slogAdapter) Infof(format string, args ...any) {
	s.logger.Info("pyroscope: " + fmt.Sprintf(format, args...)) //nolint:sloglint // SDK-formatted message, no context available
}

func (s slogAdapter) Debugf(format string, args ...any) {
	s.logger.Debug("pyroscope: " + fmt.Sprintf(format, args...)) //nolint:sloglint // SDK-formatted message, no context available
}

func (s slogAdapter) Errorf(format string, args ...any) {
	s.logger.Error("pyroscope: " + fmt.Sprintf(format, args...)) //nolint:sloglint // SDK-formatted message, no context available
}
