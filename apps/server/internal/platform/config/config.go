// Package config loads process configuration from the environment. All
// configuration is environment-driven (12-factor) so the same binary/image
// runs unchanged in development, test, staging and production — see
// docs/content/server/deployment.md.
//
// Load parses AND validates: the process refuses to start on a missing,
// malformed or unsafe value (e.g. the development signing key in production)
// instead of failing later under load.
//
// OpenTelemetry is configured through the standard OTEL_* environment
// variables (OTEL_EXPORTER_OTLP_ENDPOINT, OTEL_EXPORTER_OTLP_HEADERS,
// OTEL_EXPORTER_OTLP_PROTOCOL, OTEL_RESOURCE_ATTRIBUTES, ...) read directly by
// the SDK, so any OTLP backend works without code changes.
package config

import (
	"errors"
	"fmt"
	"net/url"
	"os"
	"slices"
	"strings"

	"github.com/caarlos0/env/v11"
)

// Env identifies the deployment environment.
type Env string

const (
	EnvDevelopment Env = "development"
	EnvTest        Env = "test"
	EnvStaging     Env = "staging"
	EnvProduction  Env = "production"
)

// IsDeployed reports whether e is a shared, non-local environment where
// development defaults must never be accepted.
func (e Env) IsDeployed() bool { return e == EnvStaging || e == EnvProduction }

// Config is the full process configuration. Fail-fast semantics: Load returns
// an error rather than starting the process with a missing required value.
type Config struct {
	Env Env `env:"AEDST_ENV" envDefault:"development"`

	HTTP      HTTPConfig
	DB        DatabaseConfig
	Cache     CacheConfig
	Search    SearchConfig
	Flags     FlagsConfig
	Auth      AuthConfig
	OIDC      OIDCConfig
	Obs       ObservabilityConfig
	Client    ClientConfig
	Retention RetentionConfig
	Server    ServerConfig
	Jobs      JobsConfig
	Storage   StorageConfig
	Push      PushConfig
	Media     MediaConfig
	Imgproxy  ImgproxyConfig
	Tasks     TasksConfig
	Integrity IntegrityConfig
	AppAttest AppAttestConfig
	NATS      NATSConfig
	// Topology selects the units this process hosts and the URLs of the others
	// (AEDST_MODULES, AEDST_MODULE_<NAME>_URL); the default is the whole monolith.
	Topology TopologyConfig
}

type HTTPConfig struct {
	Addr string `env:"AEDST_HTTP_ADDR" envDefault:":8080"`
	// MetricsAddr is the listen address of the optional Prometheus scrape
	// endpoint (/metrics). Empty disables it; OTLP push is unaffected.
	MetricsAddr string `env:"AEDST_METRICS_ADDR" envDefault:""`
	// PprofEnabled serves net/http/pprof under /debug/pprof/ on the metrics
	// listener (never the public port). It needs AEDST_METRICS_ADDR. Heap and
	// goroutine profiles expose process internals: reach it by port-forward only.
	PprofEnabled    bool `env:"AEDST_PPROF_ENABLED" envDefault:"false"`
	ShutdownTimeout int  `env:"AEDST_SHUTDOWN_TIMEOUT_SECONDS" envDefault:"15"`
	// ShutdownDrainSeconds is how long /readyz reports not-ready before the
	// listener stops accepting, so a load balancer can drain the instance.
	// Set to the LB's health-check interval x threshold in production.
	ShutdownDrainSeconds int `env:"AEDST_SHUTDOWN_DRAIN_SECONDS" envDefault:"0"`
	RequestTimeout       int `env:"AEDST_REQUEST_TIMEOUT_SECONDS" envDefault:"30"`
	// MaxRequestBytes caps a single RPC request message.
	MaxRequestBytes int `env:"AEDST_MAX_REQUEST_BYTES" envDefault:"1048576"`
	// AllowedOrigins lists the browser origins (apps/web/app on :3000 and apps/web/admin on :3001 in local dev; production origins are set per environment)
	// permitted to call the ConnectRPC API cross-origin. Connect's protocol is
	// plain HTTP/JSON so browsers can call it directly (see
	// docs/content/decisions/0002-connectrpc.md), but that still requires CORS.
	AllowedOrigins []string `env:"AEDST_CORS_ALLOWED_ORIGINS" envSeparator:"," envDefault:"http://localhost:3000,http://localhost:3001"`
	// TrustedProxyHops is the exact number of reverse proxies between the
	// public internet and this server (Cloudflare -> ALB = 2). 0 means the
	// socket peer is the client. Wrong values let clients spoof the IP used for
	// rate limiting, so verify after deploying (see internal/platform/clientip).
	TrustedProxyHops int `env:"AEDST_TRUSTED_PROXY_HOPS" envDefault:"0"`
	// AuthRateLimitPerMinute is the per-client-IP budget for the public
	// authentication RPCs (register/login/refresh). 0 disables.
	AuthRateLimitPerMinute int `env:"AEDST_AUTH_RATE_LIMIT_PER_MINUTE" envDefault:"30"`
	// AuthFailRateLimitPerMinute is the per-client-IP budget of failed
	// authentications (missing or invalid bearer token) on authenticated RPCs;
	// once spent, that address gets RESOURCE_EXHAUSTED until the window passes.
	// Successful requests cost nothing. 0 disables.
	AuthFailRateLimitPerMinute int `env:"AEDST_AUTH_FAIL_RATE_LIMIT_PER_MINUTE" envDefault:"60"`
	// APIRateLimitPerMinute is the per-user budget for authenticated RPCs,
	// shared by every replica through Dragonfly. It bounds what one account (or one
	// leaked token) can take from everyone else. 0 disables.
	APIRateLimitPerMinute int `env:"AEDST_API_RATE_LIMIT_PER_MINUTE" envDefault:"1200"`
	// MaxInFlight caps concurrently processing requests per instance; the excess
	// is shed with 429 + Retry-After rather than queued until latency collapses.
	// 0 disables.
	MaxInFlight int `env:"AEDST_MAX_IN_FLIGHT" envDefault:"1024"`
	// GRPCReflectionEnabled serves gRPC server reflection (schema discovery for
	// grpcurl and similar). Off by default: it publishes the whole API surface
	// to anyone who can reach the port.
	GRPCReflectionEnabled bool `env:"AEDST_GRPC_REFLECTION_ENABLED" envDefault:"false"`
}

type DatabaseConfig struct {
	DSN      string `env:"AEDST_DATABASE_URL,required"`
	MaxConns int32  `env:"AEDST_DATABASE_MAX_CONNS" envDefault:"20"`
	MinConns int32  `env:"AEDST_DATABASE_MIN_CONNS" envDefault:"2"`
	// MaxConnLifetimeMinutes recycles connections so a failover/DNS change is
	// picked up and server-side memory does not grow unbounded.
	MaxConnLifetimeMinutes int `env:"AEDST_DATABASE_MAX_CONN_LIFETIME_MINUTES" envDefault:"60"`
	MaxConnIdleMinutes     int `env:"AEDST_DATABASE_MAX_CONN_IDLE_MINUTES" envDefault:"15"`
	// StatementTimeoutMs aborts runaway queries server-side (0 = no limit).
	StatementTimeoutMs int `env:"AEDST_DATABASE_STATEMENT_TIMEOUT_MS" envDefault:"15000"`
	// IdleInTxTimeoutMs kills sessions that hold a transaction open while
	// idle (0 = no limit).
	IdleInTxTimeoutMs int `env:"AEDST_DATABASE_IDLE_IN_TX_TIMEOUT_MS" envDefault:"30000"`

	// JobsMaxConns sizes the second pool used by background work (River,
	// event consumers). Keeping it apart from MaxConns means a
	// burst of jobs can only exhaust its own connections, never the ones
	// request handlers need — and a slow request storm cannot starve the
	// workers either. Budget: replicas x (MaxConns + JobsMaxConns) must stay
	// below Postgres max_connections (or PgBouncer's server pool).
	JobsMaxConns int32 `env:"AEDST_DATABASE_JOBS_MAX_CONNS" envDefault:"30"`
	// DirectDSN, when set, is used by the jobs pool instead of DSN. Point DSN
	// at PgBouncer (transaction pooling) for request traffic and DirectDSN at
	// Postgres itself: River uses LISTEN/NOTIFY and platform/lock uses
	// session-level advisory locks, neither of which survives transaction
	// pooling.
	DirectDSN string `env:"AEDST_DATABASE_DIRECT_DSN" envDefault:""`
	// ReadDSN, when set, opens a third pool (modulekit.Env.ReadPool) on a read
	// replica (CloudNativePG "-ro" service, an RDS reader endpoint). Only
	// modules whose queries tolerate replica lag use it (search today); every
	// write and every read-your-writes path stays on AEDST_DATABASE_URL. Empty
	// = ReadPool is the primary pool. It sits behind the same AEDST_DATABASE_POOLER
	// mode as the primary. See docs/content/server/runbook-postgres-scaling.md.
	ReadDSN string `env:"AEDST_DATABASE_READ_URL" envDefault:""`
	// ReadMaxConns sizes the read pool (0 = same as AEDST_DATABASE_MAX_CONNS).
	// Budget it like the others: replicas x ReadMaxConns counts against the
	// replica's max_connections.
	ReadMaxConns int32 `env:"AEDST_DATABASE_READ_MAX_CONNS" envDefault:"0"`
	// AllowUnverifiedTLS is the explicit opt-out of the requirement that every
	// DSN in staging and production uses sslmode=verify-full or verify-ca.
	AllowUnverifiedTLS bool `env:"AEDST_DATABASE_ALLOW_UNVERIFIED_TLS" envDefault:"false"`
	// Pooler declares the connection pooler in front of AEDST_DATABASE_URL:
	// "none" (default; direct Postgres or a session-mode pooler) or
	// "pgbouncer" (PgBouncer / CloudNativePG Pooler in transaction mode). With
	// "pgbouncer" the API pool is forced onto pgx QueryExecModeCacheDescribe
	// (no named prepared statements) regardless of the DSN, and Validate
	// requires AEDST_DATABASE_DIRECT_DSN or AEDST_JOBS_POLL_ONLY=true, because
	// River's LISTEN/NOTIFY does not work through transaction pooling.
	Pooler string `env:"AEDST_DATABASE_POOLER" envDefault:"none"`
	// Modules are the per-module overrides AEDST_DATABASE_URL_<MODULE>[_JOBS]
	// (database-per-module). Filled by Load; see moduledb.go.
	Modules map[string]ModuleDatabase `env:"-"`
}

// Supported AEDST_DATABASE_POOLER values.
const (
	PoolerNone      = "none"
	PoolerPgBouncer = "pgbouncer"
)

// CacheConfig configures the Dragonfly (cache + rate limiting) connection. It
// supersedes AEDST_VALKEY_* (still read for one release, see legacy_env.go) and
// AEDST_REDIS_*; the go-redis client speaks the Redis protocol DragonflyDB implements.
type CacheConfig struct {
	Addr     string `env:"AEDST_CACHE_ADDR" envDefault:"localhost:6379"`
	Password string `env:"AEDST_CACHE_PASSWORD" envDefault:""`
	DB       int    `env:"AEDST_CACHE_DB" envDefault:"0"`
	// TLS connects to Dragonfly over TLS (TLS 1.2+). Required in staging and
	// production unless AllowPlaintext is set: the password and every
	// rate-limit key would otherwise cross the network in clear.
	TLS bool `env:"AEDST_CACHE_TLS" envDefault:"false"`
	// TLSServerName is the name verified in the server certificate (default:
	// the host of AEDST_CACHE_ADDR).
	TLSServerName string `env:"AEDST_CACHE_TLS_SERVER_NAME" envDefault:""`
	// TLSCAFile is a PEM bundle of the CA that signed the server certificate
	// (default: the system roots).
	TLSCAFile string `env:"AEDST_CACHE_TLS_CA_FILE" envDefault:""`
	// AllowPlaintext is the explicit opt-out of the TLS requirement, for a
	// Dragonfly inside a trusted network segment.
	AllowPlaintext bool `env:"AEDST_CACHE_ALLOW_PLAINTEXT" envDefault:"false"`
}

// SearchConfig configures the Meilisearch connection. Search is optional and
// off while URL is empty: modules then serve lookups from pg_trgm and index
// jobs are not enqueued. PostgreSQL stays the source of truth.
type SearchConfig struct {
	URL string `env:"AEDST_SEARCH_URL" envDefault:""`
	// APIKey is the Meilisearch API key the server uses (a key scoped to the
	// documents and search actions, not the master key). Required in staging and
	// production when URL is set.
	APIKey string `env:"AEDST_SEARCH_API_KEY" envDefault:""`
	// TimeoutMs bounds every call to the engine.
	TimeoutMs int `env:"AEDST_SEARCH_TIMEOUT_MS" envDefault:"5000"`
}

// Enabled reports whether a search engine is configured.
func (c SearchConfig) Enabled() bool { return c.URL != "" }

// FlagsConfig configures feature flags (OpenFeature with the flagd provider).
// Flags are off while FlagdHost is empty: every flag evaluates to the default in
// code. Flags gate rollout, never correctness.
type FlagsConfig struct {
	FlagdHost string `env:"AEDST_FLAGS_FLAGD_HOST" envDefault:""`
	FlagdPort uint16 `env:"AEDST_FLAGS_FLAGD_PORT" envDefault:"8013"`
}

// Enabled reports whether a flag provider is configured.
func (c FlagsConfig) Enabled() bool { return c.FlagdHost != "" }

// AuthConfig holds the authorization settings that sit on top of OIDC token
// verification (see OIDCConfig). The server issues no tokens and stores no
// credentials (ADR-0019).
type AuthConfig struct {
	// RolePolicy restricts procedures to callers holding one of the listed roles:
	// "/pkg.Service/Method=role|role,/pkg.Other/Method=role". A procedure that is
	// unknown or public is a startup error (see httpserver.ValidateRolePolicy), so
	// a typo cannot leave the real RPC open. Empty means every authenticated caller
	// may call every RPC.
	RolePolicy map[string]string `env:"AEDST_ROLE_POLICY" envSeparator:"," envKeyValSeparator:"=" envDefault:""`
}

// OIDCConfig makes the server an OIDC resource server: it accepts access
// tokens issued by any standards-compliant provider (ZITADEL by default,
// Keycloak, Ory Hydra, Auth0, ...). Nothing here is provider-specific.
// NATSConfig configures the optional bridge that forwards integration events to
// NATS JetStream for the realtime gateway (ADR-0021). Empty URL disables it:
// nothing is connected and no consumer is registered.
type NATSConfig struct {
	URL string `env:"AEDST_NATS_URL" envDefault:""`
	// Stream is the JetStream stream that holds forwarded events.
	Stream string `env:"AEDST_NATS_STREAM" envDefault:"AEDST_EVENTS"`
	// ForwardTypes lists the event types forwarded to the gateway (an
	// allowlist: a new realtime event is an explicit entry).
	ForwardTypes []string `env:"AEDST_NATS_FORWARD_TYPES" envSeparator:"," envDefault:""`
	// RecipientField is the payload field that names the recipient user id.
	RecipientField string `env:"AEDST_NATS_RECIPIENT_FIELD" envDefault:"user_id"`
	Replicas       int    `env:"AEDST_NATS_REPLICAS" envDefault:"1"`
	MaxAgeHours    int    `env:"AEDST_NATS_MAX_AGE_HOURS" envDefault:"24"`
	// DuplicateWindowSeconds is JetStream's Nats-Msg-Id dedup window.
	DuplicateWindowSeconds int `env:"AEDST_NATS_DUPLICATE_WINDOW_SECONDS" envDefault:"120"`
}

type OIDCConfig struct {
	// Issuer is the provider's issuer URL; discovery is fetched from
	// <issuer>/.well-known/openid-configuration.
	Issuer string `env:"AEDST_OIDC_ISSUER" envDefault:""`
	// Audience is the value that must appear in the token's aud claim
	// (typically the API's client id / project id).
	Audience string `env:"AEDST_OIDC_AUDIENCE" envDefault:""`
	// JWKSURL overrides the jwks_uri found in discovery (rarely needed).
	JWKSURL string `env:"AEDST_OIDC_JWKS_URL" envDefault:""`
	// Algorithms is the allow-list of accepted JWS algorithms. Asymmetric
	// only: HS* is refused for external issuers (algorithm-confusion guard).
	Algorithms []string `env:"AEDST_OIDC_ALGORITHMS" envSeparator:"," envDefault:"RS256,ES256,EdDSA"`
	// TokenTypes is the allow-list of the JOSE header typ of an access token:
	// "at+jwt" (RFC 9068) and "JWT" (Keycloak and others). A token with another
	// typ, or none, is rejected, which keeps ID and logout tokens out.
	TokenTypes []string `env:"AEDST_OIDC_TOKEN_TYPES" envSeparator:"," envDefault:"at+jwt,JWT"`
	// RolesClaim locates roles in the token: a top-level claim name or a
	// dotted path. ZITADEL: "urn:zitadel:iam:org:project:roles" (an object keyed
	// by role name); Keycloak: "realm_access.roles". An array of strings or an
	// object keyed by role name are both understood.
	RolesClaim string `env:"AEDST_OIDC_ROLES_CLAIM" envDefault:"roles"`
	// RolesOrg (optional) is an organisation id. For an object-shaped roles
	// claim ({role: {orgId: domain}}, ZITADEL: roles are bound to an
	// organisation) only roles granted in that organisation count. Empty = any.
	RolesOrg         string `env:"AEDST_OIDC_ROLES_ORG" envDefault:""`
	ClockSkewSeconds int    `env:"AEDST_OIDC_CLOCK_SKEW_SECONDS" envDefault:"30"`
}

type ObservabilityConfig struct {
	LogLevel    string `env:"AEDST_LOG_LEVEL" envDefault:"info"`
	LogFormat   string `env:"AEDST_LOG_FORMAT" envDefault:"json"`
	ServiceName string `env:"AEDST_SERVICE_NAME" envDefault:"aedst-server"`
	// OTLPEndpoint / OTLPTracesEndpoint mirror the standard OTEL_* variables
	// only so startup can tell whether telemetry export is configured at all;
	// the SDK reads the real values (and headers, protocol, ...) itself.
	OTLPEndpoint       string `env:"OTEL_EXPORTER_OTLP_ENDPOINT" envDefault:""`
	OTLPTracesEndpoint string `env:"OTEL_EXPORTER_OTLP_TRACES_ENDPOINT" envDefault:""`

	// Continuous profiling (Grafana Pyroscope SDK, push to Grafana Cloud Profiles
	// or an existing Pyroscope server). Off by default; no inbound port.
	ProfilingEnabled           bool   `env:"AEDST_PROFILING_ENABLED" envDefault:"false"`
	ProfilingServerAddress     string `env:"AEDST_PROFILING_SERVER_ADDRESS" envDefault:""`
	ProfilingBasicAuthUser     string `env:"AEDST_PROFILING_BASIC_AUTH_USER" envDefault:""`
	ProfilingBasicAuthPassword string `env:"AEDST_PROFILING_BASIC_AUTH_PASSWORD" envDefault:""`
	ProfilingTenantID          string `env:"AEDST_PROFILING_TENANT_ID" envDefault:""`
}

// ExportEnabled reports whether any OTLP endpoint is configured.
func (o ObservabilityConfig) ExportEnabled() bool {
	return o.OTLPEndpoint != "" || o.OTLPTracesEndpoint != ""
}

// Load parses configuration from the process environment and validates it.
func Load() (Config, error) {
	var cfg Config
	if err := env.ParseWithOptions(&cfg, env.Options{Environment: environment(os.Environ(), warnDeprecatedEnv)}); err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	// env.Parse applies envDefault to a variable that is set but empty. For the
	// queue list an explicit empty value is meaningful: insert-only (workers run
	// elsewhere), so it must not fall back to the default queues.
	if v, ok := os.LookupEnv("AEDST_JOBS_QUEUES"); ok && strings.TrimSpace(v) == "" {
		cfg.Jobs.Queues = nil
	}
	cfg.DB.Modules = moduleDatabases(os.Environ())
	cfg.Topology.Remote = remoteUnits(os.Environ())
	cfg.Client = cfg.Client.normalized()
	if err := cfg.Validate(); err != nil {
		return Config{}, fmt.Errorf("config: %w", err)
	}
	return cfg, nil
}

// Validate checks cross-field and environment-specific invariants, returning
// every problem at once.
func (c Config) Validate() error {
	var errs []error
	bad := func(format string, args ...any) { errs = append(errs, fmt.Errorf(format, args...)) }

	switch c.Env {
	case EnvDevelopment, EnvTest, EnvStaging, EnvProduction:
	default:
		bad("AEDST_ENV %q must be one of development, test, staging, production", c.Env)
	}

	if err := c.Topology.Validate(); err != nil {
		errs = append(errs, err)
	}
	if c.DB.MinConns > c.DB.MaxConns {
		bad("AEDST_DATABASE_MIN_CONNS (%d) must not exceed AEDST_DATABASE_MAX_CONNS (%d)", c.DB.MinConns, c.DB.MaxConns)
	}
	if c.DB.ReadMaxConns < 0 {
		bad("AEDST_DATABASE_READ_MAX_CONNS (%d) must not be negative", c.DB.ReadMaxConns)
	}
	if c.DB.ReadDSN != "" && c.DB.ReadDSN == c.DB.DSN {
		bad("AEDST_DATABASE_READ_URL equals AEDST_DATABASE_URL: leave it unset to read from the primary")
	}
	if c.DB.JobsMaxConns < 2 {
		// One connection is held by the River listener/fetch loop while a worker needs
		// another; a pool of one would stall event delivery.
		bad("AEDST_DATABASE_JOBS_MAX_CONNS (%d) must be at least 2", c.DB.JobsMaxConns)
	}
	switch c.DB.Pooler {
	case "", PoolerNone:
	case PoolerPgBouncer:
		if c.DB.DirectDSN == "" && !c.Jobs.PollOnly {
			bad("AEDST_DATABASE_POOLER=pgbouncer requires AEDST_DATABASE_DIRECT_DSN (River LISTEN/NOTIFY and session advisory locks need a direct connection) or AEDST_JOBS_POLL_ONLY=true (River polls instead of LISTEN/NOTIFY)")
		}
	default:
		bad("AEDST_DATABASE_POOLER %q must be one of %s, %s", c.DB.Pooler, PoolerNone, PoolerPgBouncer)
	}
	if c.Jobs.CompletedRetentionHours <= 0 || c.Jobs.CancelledRetentionHours <= 0 || c.Jobs.DiscardedRetentionHours <= 0 {
		bad("AEDST_JOBS_COMPLETED_RETENTION_HOURS, AEDST_JOBS_CANCELLED_RETENTION_HOURS and AEDST_JOBS_DISCARDED_RETENTION_HOURS must be positive")
	}
	if c.Retention.AuditDays < MinAuditRetentionDays {
		bad("AEDST_RETENTION_AUDIT_DAYS (%d) must be at least %d: the database refuses to delete audit rows younger than that", c.Retention.AuditDays, MinAuditRetentionDays)
	}
	if c.Retention.IntervalMinutes <= 0 || c.Retention.IdempotencyHours <= 0 || c.Retention.TombstoneHours <= 0 {
		bad("AEDST_RETENTION_* values must be positive")
	}
	if c.HTTP.APIRateLimitPerMinute < 0 || c.HTTP.MaxInFlight < 0 {
		bad("AEDST_API_RATE_LIMIT_PER_MINUTE and AEDST_MAX_IN_FLIGHT must not be negative")
	}
	if c.NATS.URL != "" && (c.NATS.Stream == "" || c.NATS.Replicas < 1 || c.NATS.MaxAgeHours <= 0 || c.NATS.DuplicateWindowSeconds <= 0) {
		bad("AEDST_NATS_STREAM must be set and AEDST_NATS_REPLICAS, AEDST_NATS_MAX_AGE_HOURS and AEDST_NATS_DUPLICATE_WINDOW_SECONDS must be positive when AEDST_NATS_URL is set")
	}
	c.validateClient(bad)
	if c.HTTP.RequestTimeout <= 0 {
		bad("AEDST_REQUEST_TIMEOUT_SECONDS must be positive")
	}
	if c.HTTP.MaxRequestBytes <= 0 {
		bad("AEDST_MAX_REQUEST_BYTES must be positive")
	}
	if c.Obs.ProfilingEnabled && c.Obs.ProfilingServerAddress == "" {
		bad("AEDST_PROFILING_ENABLED=true needs AEDST_PROFILING_SERVER_ADDRESS")
	}
	if c.HTTP.PprofEnabled && c.HTTP.MetricsAddr == "" {
		bad("AEDST_PPROF_ENABLED=true needs AEDST_METRICS_ADDR: profiles are served on the metrics listener, never the public port")
	}
	if c.Env.IsDeployed() && c.Search.Enabled() && c.Search.APIKey == "" {
		bad("AEDST_SEARCH_API_KEY is required in %s when AEDST_SEARCH_URL is set", c.Env)
	}
	if c.Search.Enabled() && c.Search.TimeoutMs <= 0 {
		bad("AEDST_SEARCH_TIMEOUT_MS must be positive")
	}
	if c.Env.IsDeployed() && !c.Cache.TLS && !c.Cache.AllowPlaintext {
		bad("AEDST_CACHE_TLS=true is required in %s (or AEDST_CACHE_ALLOW_PLAINTEXT=true to accept plaintext inside a trusted network)", c.Env)
	}
	if c.Env.IsDeployed() && !c.DB.AllowUnverifiedTLS {
		if bad := c.databaseTLSProblems(); len(bad) > 0 {
			slices.Sort(bad)
			errs = append(errs, fmt.Errorf("%s must use sslmode=verify-full (or verify-ca) in %s (or AEDST_DATABASE_ALLOW_UNVERIFIED_TLS=true)", strings.Join(bad, ", "), c.Env))
		}
	}
	if c.Env.IsDeployed() && slices.Contains(c.HTTP.AllowedOrigins, "*") {
		bad("AEDST_CORS_ALLOWED_ORIGINS must not contain \"*\" in %s", c.Env)
	}

	if c.OIDC.Issuer == "" {
		bad("AEDST_OIDC_ISSUER is required: the server is an OIDC resource server and has no other authentication (ADR-0019)")
	}
	if c.OIDC.Issuer != "" {
		u, err := url.Parse(c.OIDC.Issuer)
		switch {
		case err != nil || u.Host == "":
			bad("AEDST_OIDC_ISSUER %q is not a valid URL", c.OIDC.Issuer)
		case u.Scheme != "https" && (u.Scheme != "http" || c.Env.IsDeployed()):
			bad("AEDST_OIDC_ISSUER must use https (http is allowed only outside staging/production)")
		}
		if c.OIDC.Audience == "" {
			bad("AEDST_OIDC_AUDIENCE is required when AEDST_OIDC_ISSUER is set (audience validation must not be skipped)")
		}
		for _, alg := range c.OIDC.Algorithms {
			if strings.HasPrefix(strings.ToUpper(alg), "HS") || strings.EqualFold(alg, "none") {
				bad("AEDST_OIDC_ALGORITHMS must not include %q (asymmetric algorithms only)", alg)
			}
		}
	}
	c.validateFeatures(bad)
	c.validateAppAttest(bad)

	return errors.Join(errs...)
}

// MinAuditRetentionDays is the floor under which admin.audit_log rows cannot be deleted
// (trigger in migrations/admin/00002), so retention may not be configured below it.
const MinAuditRetentionDays = 30

// RetentionConfig bounds the append-only tables (see internal/platform/retention).
type RetentionConfig struct {
	// IntervalMinutes is how often each retention policy runs.
	IntervalMinutes int `env:"AEDST_RETENTION_INTERVAL_MINUTES" envDefault:"60"`
	// IdempotencyHours is how long an idempotency key is remembered: it only has
	// to outlive a client's retry window.
	IdempotencyHours int `env:"AEDST_RETENTION_IDEMPOTENCY_HOURS" envDefault:"48"`
	// TombstoneHours is how long the search projection keeps deletion
	// tombstones. It must exceed the longest event redelivery window (River's
	// retry backoff over 10 attempts, ~4.3 h), or a late old snapshot could
	// resurrect a deleted document.
	TombstoneHours int `env:"AEDST_RETENTION_TOMBSTONE_HOURS" envDefault:"336"`
	// NotificationDays is how long in-app notifications are kept.
	NotificationDays int `env:"AEDST_RETENTION_NOTIFICATION_DAYS" envDefault:"90"`
	// AuditDays is how long admin audit entries are kept.
	AuditDays int `env:"AEDST_RETENTION_AUDIT_DAYS" envDefault:"365"`
}
