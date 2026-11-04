package main

import (
	"context"
	"maps"
	"net/http"
	"net/http/pprof"
	"time"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connecthttp"
	"connectrpc.com/grpchealth/v2"
	"connectrpc.com/grpcreflect/v2"
	"connectrpc.com/otelconnect"

	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/platform/idempotency"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/observability"
)

// httpRuntime is what the serve loop in main.go runs.
type httpRuntime struct {
	server    *httpserver.Server
	metrics   *httpserver.Server // nil unless AEDST_METRICS_ADDR is set
	readiness *httpserver.Readiness
}

// interceptors builds the connect chain halves around protovalidate.
//
// Order matters: trace everything, log server-side failures with their real
// cause, count and turn away unsupported client versions (the cheapest check),
// throttle unauthenticated RPCs before spending any CPU on them, authenticate,
// authorize by role, throttle the authenticated caller per user, then validate
// the request against its protovalidate constraints (added by the mounter,
// always), then idempotency.
func (a *app) interceptors(ctx context.Context, rolePolicy map[string][]string, public map[string]bool) (before, after []connect.ServerInterceptor, err error) {
	cfg := a.cfg
	otelInterceptor, err := otelconnect.NewServerInterceptor()
	if err != nil {
		return nil, nil, err
	}
	before = []connect.ServerInterceptor{
		otelInterceptor,
		httpserver.ErrorHeadersInterceptor(),
		httpserver.ErrorLogInterceptor(a.logger),
		httpserver.ClientVersionInterceptor(ctx, cfg.Client.MinVersions, cfg.Client.RecommendedVersions, a.logger),
	}
	if cfg.HTTP.AuthRateLimitPerMinute > 0 {
		before = append(before, httpserver.RateLimitInterceptor(a.env.RateLimiter, public, cfg.HTTP.AuthRateLimitPerMinute, a.logger))
	}
	before = append(before,
		httpserver.AuthInterceptor(a.verifier, public, a.logger, httpserver.WithFailureThrottle(a.env.RateLimiter, cfg.HTTP.AuthFailRateLimitPerMinute)),
		httpserver.RoleInterceptor(rolePolicy),
	)
	if cfg.HTTP.APIRateLimitPerMinute > 0 {
		before = append(before, httpserver.UserRateLimitInterceptor(a.env.RateLimiter, cfg.HTTP.APIRateLimitPerMinute, a.logger))
	}
	return before, []connect.ServerInterceptor{idempotency.HeaderInterceptor()}, nil
}

// buildHTTP wires the router, the interceptor chain, every module's RPC
// service, the health/reflection endpoints and the (optional) metrics listener.
func (a *app) buildHTTP(ctx context.Context, tel *observability.Telemetry) (*httpRuntime, error) {
	cfg := a.cfg
	public, defaultRoles, knownProcedures := a.rpcSurface()
	// rolePolicy maps a procedure (or "/pkg.Service/*") to the roles of which
	// the caller needs one: the modules' built-in defaults (AdminService=admin)
	// overlaid by AEDST_ROLE_POLICY. Validated against the real procedures, so a
	// typo fails the deploy instead of silently leaving an RPC open.
	configuredPolicy, err := httpserver.ParseRolePolicy(cfg.Auth.RolePolicy)
	if err != nil {
		return nil, err
	}
	rolePolicy := httpserver.MergeRolePolicy(defaultRoles, configuredPolicy)
	if err := httpserver.ValidateRolePolicy(rolePolicy, knownProcedures, public); err != nil {
		return nil, err
	}
	before, after, err := a.interceptors(ctx, rolePolicy, public)
	if err != nil {
		return nil, err
	}

	checks := []httpserver.Check{
		{Name: "database", Fn: a.env.Pool.Ping},
		// Optional: a Valkey outage degrades rate limiting (which fails open); it
		// must not pull every replica out of rotation.
		{Name: "valkey", Optional: true, Fn: a.valkeyPing},
	}
	if a.env.ReadPool != a.env.Pool {
		// A lagging or dead replica degrades lag-tolerant reads only; the primary
		// check above is what takes an instance out of rotation.
		checks = append(checks, httpserver.Check{Name: "database_read", Optional: true, Fn: a.env.ReadPool.Ping})
	}
	readiness := httpserver.NewReadiness(checks...)
	if err := readiness.RegisterMetrics(); err != nil {
		return nil, err
	}
	streaming := map[string]bool{} // filled once every service is mounted, before serving
	router := httpserver.NewRouter(httpserver.Options{
		Logger:              a.logger,
		RequestTimeout:      time.Duration(cfg.HTTP.RequestTimeout) * time.Second,
		AllowedOrigins:      cfg.HTTP.AllowedOrigins,
		TrustedProxyHops:    cfg.HTTP.TrustedProxyHops,
		Readiness:           readiness,
		MaxInFlight:         cfg.HTTP.MaxInFlight,
		MaxBodyBytes:        int64(cfg.HTTP.MaxRequestBytes) + 4096, // message cap + envelope/framing
		HSTSMaxAge:          time.Duration(cfg.Server.HSTSMaxAgeSeconds) * time.Second,
		StreamingProcedures: streaming,
	})

	rpc := modulekit.NewMounter(router.ServeMux, before, after, cfg.HTTP.MaxRequestBytes, cfg.Server.RequireConnectProtocolHeader).WithLogger(a.logger)
	if err := a.mountModules(rpc); err != nil {
		return nil, err
	}
	if err := rpc.VerifyKnown(knownProcedures); err != nil {
		return nil, err
	}
	maps.Copy(streaming, rpc.StreamingProcedures())

	// Standard gRPC health (driven by the same Readiness as /readyz) and, when
	// enabled, server reflection. Neither sits behind auth: probes must work
	// without a token, and reflection is opt-in for that reason.
	services := rpc.Services()
	probes := connect.NewServer()
	grpchealth.Register(probes, httpserver.NewHealthChecker(readiness, services...))
	if cfg.HTTP.GRPCReflectionEnabled {
		// Describe the application services; the default would only list the
		// probe server's own (health, reflection).
		grpcreflect.Register(probes, grpcreflect.WithNamer(grpcreflect.NamerFunc(func() []string { return services })))
	}
	connecthttp.Mount(router.ServeMux, probes)
	for spec := range probes.Specs() {
		if spec.StreamType != connect.StreamTypeUnary { // Watch / ServerReflectionInfo outlive the unary timeouts
			streaming[spec.Procedure] = true
		}
	}

	rt := &httpRuntime{readiness: readiness}
	rt.server = httpserver.NewWithConfig(httpserver.ServerConfig{
		Addr:              cfg.HTTP.Addr,
		ReadHeaderTimeout: time.Duration(cfg.Server.ReadHeaderTimeoutSeconds) * time.Second,
		ReadTimeout:       time.Duration(cfg.Server.ReadTimeoutSeconds) * time.Second,
		WriteTimeout:      time.Duration(cfg.Server.WriteTimeoutSeconds) * time.Second,
		IdleTimeout:       time.Duration(cfg.Server.IdleTimeoutSeconds) * time.Second,
		MaxHeaderBytes:    cfg.Server.MaxHeaderBytes,
		TLSCertFile:       cfg.Server.TLSCertFile,
		TLSKeyFile:        cfg.Server.TLSKeyFile,
	}, httpserver.Instrument(router, cfg.Obs.ServiceName), a.logger)

	// Optional Prometheus scrape endpoint on its own listener, so it is never
	// exposed on the public port. OTLP push works with or without it.
	if cfg.HTTP.MetricsAddr != "" {
		metricsRouter := http.NewServeMux()
		metricsRouter.Handle("GET /metrics", tel.MetricsHandler)
		if cfg.HTTP.PprofEnabled {
			mountPprof(metricsRouter)
		}
		rt.metrics = httpserver.New(cfg.HTTP.MetricsAddr, metricsRouter, a.logger)
	}
	return rt, nil
}

// mountPprof serves the runtime profiles on the metrics listener (explicit
// handlers: importing net/http/pprof for its side effect would register them on
// http.DefaultServeMux).
func mountPprof(mux *http.ServeMux) {
	mux.HandleFunc("GET /debug/pprof/", pprof.Index) // heap, goroutine, allocs, block, mutex, ...
	mux.HandleFunc("GET /debug/pprof/cmdline", pprof.Cmdline)
	mux.HandleFunc("GET /debug/pprof/profile", pprof.Profile)
	mux.HandleFunc("GET /debug/pprof/symbol", pprof.Symbol)
	mux.HandleFunc("GET /debug/pprof/trace", pprof.Trace)
}
