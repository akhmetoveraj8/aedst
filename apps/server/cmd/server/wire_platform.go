package main

import (
	"cmp"
	"context"
	"crypto/tls"
	"fmt"
	"log/slog"
	"slices"
	"time"

	"github.com/jackc/pgx/v5/pgxpool"

	platformjobs "github.com/aedst/server/internal/platform/jobs"

	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/cache"
	"github.com/aedst/server/internal/platform/config"
	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/modulekit"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// app is the composition root's state: what the platform steps build (into
// env, which every module receives) plus the few things only the root needs.
// It holds wiring only, no business logic. Steps run in the order listed in
// run (main.go); modules are built by wireModules from the registry
// (internal/platform/modulekit), never named here.
type app struct {
	cfg     config.Config
	logger  *slog.Logger
	clock   sharedtime.Real
	closers []func()

	env    *modulekit.Env
	mods   []modulekit.Module // units hosted by this process, dependencies first
	remote []modulekit.Module // units this process reaches over the network (AEDST_MODULE_<NAME>_URL)
	plan   modulekit.Plan     // the whole topology: its Others feed the event catalog

	cachePing func(context.Context) error
	verifier  *platformauth.OIDCVerifier
}

// onClose registers a cleanup; close runs them in reverse registration order,
// like stacked defers.
func (a *app) onClose(f func()) { a.closers = append(a.closers, f) }

func (a *app) close() {
	for _, v := range slices.Backward(a.closers) {
		v()
	}
}

func (a *app) poolConfig(dsn string, maxConns, minConns int32, name string, pooler database.Pooler) database.Config {
	db := a.cfg.DB
	return database.Config{
		DSN:              dsn,
		MaxConns:         maxConns,
		MinConns:         minConns,
		MaxConnLifetime:  time.Duration(db.MaxConnLifetimeMinutes) * time.Minute,
		MaxConnIdleTime:  time.Duration(db.MaxConnIdleMinutes) * time.Minute,
		StatementTimeout: time.Duration(db.StatementTimeoutMs) * time.Millisecond,
		IdleInTxTimeout:  time.Duration(db.IdleInTxTimeoutMs) * time.Millisecond,
		ApplicationName:  name,
		Pooler:           pooler,
	}
}

// openDatabases opens the request pool and the separate jobs pool.
//
// Background work (River, event consumers) gets its own pool so a burst of
// jobs can only exhaust its own connections, never the ones request handlers
// need — and vice versa. It also lets that pool bypass a transaction-pooling
// proxy (PgBouncer, RDS Proxy) via AEDST_DATABASE_DIRECT_DSN: River's
// LISTEN/NOTIFY and platform/lock's session-level advisory locks do not
// survive transaction pooling. A job-enqueue inside a request transaction
// (InsertTx) still rides that transaction on the main pool.
//
// Without a direct DSN the jobs pool shares the pooler's constraints (config
// validation then requires AEDST_JOBS_POLL_ONLY=true), so it gets the same
// exec-mode treatment. Session-scoped features (lock.Locker) may only be built
// from a database.NewDirectPool on the direct DSN, never from either of these
// pools.
func (a *app) openDatabases(ctx context.Context) error {
	cfg := a.cfg
	pooler := database.Pooler(cfg.DB.Pooler) // pgbouncer forces CacheDescribe
	pool, err := database.NewPool(ctx, a.poolConfig(cfg.DB.DSN, cfg.DB.MaxConns, cfg.DB.MinConns, cfg.Obs.ServiceName, pooler))
	if err != nil {
		return err
	}
	a.env.Pool = pool
	a.onClose(pool.Close)

	jobsDSN, jobsPooler := cfg.DB.DSN, pooler
	if cfg.DB.DirectDSN != "" {
		jobsDSN, jobsPooler = cfg.DB.DirectDSN, database.PoolerNone
	}
	jobsPool, err := database.NewPool(ctx, a.poolConfig(jobsDSN, cfg.DB.JobsMaxConns, 1, cfg.Obs.ServiceName+"-jobs", jobsPooler))
	if err != nil {
		return err
	}
	a.env.JobsPool = jobsPool
	a.env.JobStats = platformjobs.NewPoolStats(jobsPool)
	a.onClose(jobsPool.Close)

	// Optional read replica for lag-tolerant reads; without it ReadPool IS the
	// primary pool, so modules never branch on whether a replica exists.
	a.env.ReadPool = pool
	if cfg.DB.ReadDSN != "" {
		readConns := cfg.DB.ReadMaxConns
		if readConns == 0 {
			readConns = cfg.DB.MaxConns
		}
		readPool, err := database.NewPool(ctx, a.poolConfig(cfg.DB.ReadDSN, readConns, min(cfg.DB.MinConns, readConns), cfg.Obs.ServiceName+"-read", pooler))
		if err != nil {
			return err
		}
		a.env.ReadPool = readPool
		a.onClose(readPool.Close)
		if err := database.RegisterPoolMetrics("read", readPool); err != nil {
			return err
		}
	}

	// Pool saturation is the first thing that breaks under load; export it.
	if err := database.RegisterPoolMetrics("api", pool); err != nil {
		return err
	}
	return database.RegisterPoolMetrics("jobs", jobsPool)
}

// openCache builds the cache/rate-limit client. Dragonfly is optional: nothing
// correct depends on it, so it neither blocks startup nor readiness. The
// limiters fail open.
func (a *app) openCache(ctx context.Context) error {
	vc := a.cfg.Cache
	var tlsCfg *tls.Config
	if vc.TLS {
		var err error
		if tlsCfg, err = cache.TLSConfig(vc.Addr, vc.TLSServerName, vc.TLSCAFile); err != nil {
			return err
		}
	}
	client := cache.NewClient(cache.Config{
		TLS:      tlsCfg,
		Addr:     a.cfg.Cache.Addr,
		Password: a.cfg.Cache.Password,
		DB:       a.cfg.Cache.DB,
	})
	a.onClose(func() { _ = client.Close() })
	if err := cache.Ping(ctx, client); err != nil {
		a.logger.WarnContext(ctx, "cache unreachable at startup; rate limiting will fail open until it is back", slog.Any("error", err))
	}
	a.env.RateLimiter = cache.NewRateLimiter(client)
	a.cachePing = func(ctx context.Context) error { return cache.Ping(ctx, client) }
	return nil
}

// openModuleDatabases opens the pools of modules that run on their own database
// (AEDST_DATABASE_URL_<MODULE>[_JOBS]): database-per-module, the first step of
// extracting a module. Unset modules keep the shared pools. A module's migrations
// must be applied to its own database (docs/content/server/runbook-extract-service.md).
func (a *app) openModuleDatabases(ctx context.Context) error {
	if len(a.cfg.DB.Modules) == 0 {
		return nil
	}
	names := make([]string, len(a.mods))
	for i, m := range a.mods {
		names[i] = m.Name
	}
	if err := a.cfg.ValidateModuleDatabases(names); err != nil {
		return err
	}
	db := a.cfg.DB
	for _, name := range names { // registry order: deterministic
		md, ok := db.Modules[name]
		if !ok {
			continue
		}
		var api, jobs *pgxpool.Pool
		var err error
		if md.DSN != "" {
			api, err = database.NewPool(ctx, a.poolConfig(md.DSN, db.MaxConns, db.MinConns, a.cfg.Obs.ServiceName+"-"+name, database.Pooler(db.Pooler)))
			if err != nil {
				return fmt.Errorf("module %s database: %w", name, err)
			}
			a.onClose(api.Close)
			if err := database.RegisterPoolMetrics("api-"+name, api); err != nil {
				return err
			}
		}
		if jobsDSN := cmp.Or(md.JobsDSN, md.DSN); jobsDSN != "" {
			jobs, err = database.NewPool(ctx, a.poolConfig(jobsDSN, db.JobsMaxConns, 1, a.cfg.Obs.ServiceName+"-jobs-"+name, jobsPoolerFor(md, db)))
			if err != nil {
				return fmt.Errorf("module %s jobs database: %w", name, err)
			}
			a.onClose(jobs.Close)
			if err := database.RegisterPoolMetrics("jobs-"+name, jobs); err != nil {
				return err
			}
		}
		a.env.SetModulePools(name, api, jobs)
	}
	return nil
}

// jobsPoolerFor: an explicit _JOBS DSN is a direct connection; deriving the jobs
// pool from the request DSN keeps the request pooler's exec mode.
func jobsPoolerFor(md config.ModuleDatabase, db config.DatabaseConfig) database.Pooler {
	if md.JobsDSN != "" {
		return database.PoolerNone
	}
	return database.Pooler(db.Pooler)
}
