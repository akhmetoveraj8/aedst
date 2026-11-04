// Command server is the aedst-server entrypoint. It only wires dependencies —
// config, platform, modules — together; it contains no business logic (see
// docs/content/server/architecture.md). The wiring is split by concern:
// wire_platform.go (pools, Valkey), wire_auth.go (token verifier),
// wire_jobs.go (River, retention), wire_push.go, wire_modules.go (iterates the
// module registry: setup, mounting, RPC surface), modules.go (the one import
// line per module) and wire_http.go (router, interceptors). Modules register
// themselves (internal/platform/modulekit); this package never names one.
package main

import (
	"context"
	"errors"
	"log/slog"
	"os"
	"os/signal"
	"syscall"
	"time"

	"golang.org/x/sync/errgroup"

	"github.com/aedst/server/internal/platform/config"
	platformjobs "github.com/aedst/server/internal/platform/jobs"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/observability"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

func main() {
	os.Exit(exitCode())
}

// exitCode runs the server and maps its result to a process exit status; it is a
// separate function so the signal context is released before os.Exit.
func exitCode() int {
	ctx, stop := signal.NotifyContext(context.Background(), os.Interrupt, syscall.SIGTERM)
	defer stop()

	if err := run(ctx); err != nil {
		slog.ErrorContext(ctx, "server exited with error", slog.Any("error", err))
		return 1
	}
	return 0
}

func run(ctx context.Context) error {
	cfg, err := config.Load()
	if err != nil {
		return err
	}

	tel, err := observability.Setup(ctx, observability.Config{
		ServiceName:   cfg.Obs.ServiceName,
		LogLevel:      cfg.Obs.LogLevel,
		LogFormat:     cfg.Obs.LogFormat,
		ExportEnabled: cfg.Obs.ExportEnabled(),
	})
	if err != nil {
		return err
	}
	logger := tel.Logger
	slog.SetDefault(logger)
	// Flush telemetry last, after every component that emits it has stopped.
	defer func() {
		flushCtx, cancel := context.WithTimeout(context.WithoutCancel(ctx), 5*time.Second)
		defer cancel()
		if err := tel.Shutdown(flushCtx); err != nil {
			logger.WarnContext(flushCtx, "telemetry shutdown", slog.Any("error", err))
		}
	}()

	a := &app{cfg: cfg, logger: logger, clock: sharedtime.Real{}}
	a.env = &modulekit.Env{Config: cfg, Logger: logger, Clock: a.clock}
	// Modules close their own resources first (they were opened last), then the
	// pools they used.
	defer a.close()
	defer a.env.Close()
	if a.mods, err = modulekit.Ordered(); err != nil {
		return err
	}

	// Order matters: each step uses what the earlier ones built.
	for _, step := range []func(context.Context) error{
		a.openDatabases, a.openModuleDatabases, a.openValkey, a.buildVerifier,
		a.buildPush, a.buildJobs, a.wireModules,
	} {
		if err := step(ctx); err != nil {
			return err
		}
	}
	rt, err := a.buildHTTP(ctx, tel)
	if err != nil {
		return err
	}
	return a.serve(ctx, rt)
}

// serve runs the HTTP server(s) and River until ctx is cancelled, then shuts
// down gracefully.
//
// River workers outlive the signal context: they are stopped gracefully (letting
// in-flight jobs finish) rather than hard-cancelled, after the HTTP server has
// drained. Events committed by in-flight requests are River jobs, so whichever
// replica is still working the queue delivers them. An insert-only process
// (AEDST_JOBS_QUEUES empty) never starts River's fetch loops.
func (a *app) serve(ctx context.Context, rt *httpRuntime) error {
	cfg, logger := a.cfg, a.logger
	jobsWork := platformjobs.Works(cfg.Jobs.Queues)
	if jobsWork {
		if err := platformjobs.Start(context.WithoutCancel(ctx), a.env.Jobs); err != nil {
			return err
		}
	}

	group, groupCtx := errgroup.WithContext(ctx)
	group.Go(func() error {
		logger.InfoContext(groupCtx, "aedst-server listening", slog.String("addr", cfg.HTTP.Addr), slog.String("env", string(cfg.Env)),
			slog.Any("job_queues", cfg.Jobs.Queues), slog.Bool("tls", cfg.Server.TLSCertFile != ""))
		return rt.server.ListenAndServe()
	})
	if rt.metrics != nil {
		group.Go(func() error {
			logger.InfoContext(groupCtx, "metrics listening", slog.String("addr", cfg.HTTP.MetricsAddr))
			return rt.metrics.ListenAndServe()
		})
	}

	// Graceful shutdown: fail readiness first so the load balancer stops
	// routing, optionally wait for it to notice, stop accepting and drain
	// in-flight requests, then let River finish running jobs.
	group.Go(func() error {
		<-groupCtx.Done()
		logger.InfoContext(groupCtx, "shutting down")
		rt.readiness.SetDraining()
		if drain := time.Duration(cfg.HTTP.ShutdownDrainSeconds) * time.Second; drain > 0 {
			time.Sleep(drain)
		}

		shutdownCtx, cancel := context.WithTimeout(context.WithoutCancel(groupCtx), time.Duration(cfg.HTTP.ShutdownTimeout)*time.Second)
		defer cancel()

		var errs []error
		errs = append(errs, rt.server.Shutdown(shutdownCtx))
		if rt.metrics != nil {
			errs = append(errs, rt.metrics.Shutdown(shutdownCtx))
		}
		if jobsWork {
			errs = append(errs, platformjobs.Stop(shutdownCtx, a.env.Jobs))
		}
		return errors.Join(errs...)
	})

	return group.Wait()
}
