// Package modulekit is the module registry: the one seam between cmd/server
// (the composition root) and the business modules.
//
// Each module declares itself once, from the init() of its own
// internal/modules/<name>/module package, with Register. cmd/server blank-imports
// that package (one line in cmd/server/modules.go) and then only iterates the
// registry: it never names a module's types. A module therefore declares
//
//   - what it needs (Requires: modules that must be set up before it),
//   - how it is built (Setup: services, River workers, event consumers),
//   - what it mounts (Mount: its Connect services, through the one Mounter),
//   - what it keeps bounded (Retention) and what its RPC surface is for the
//     auth/role machinery (Files, Public, Roles).
//
// Modules reach each other only through api/ packages: a module publishes an
// api interface with Provide and another module takes it with Require/Lookup.
// architecturetest fails when a module directory has no registration or is not
// imported by cmd/server, so a module cannot be forgotten.
package modulekit

import (
	"context"
	"fmt"
	"log/slog"
	"reflect"
	"slices"
	"sort"
	"sync"

	"github.com/jackc/pgx/v5/pgxpool"
	"github.com/riverqueue/river"
	"google.golang.org/protobuf/reflect/protoreflect"

	"github.com/aedst/server/internal/platform/cache"
	"github.com/aedst/server/internal/platform/config"
	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/flags"
	platformjobs "github.com/aedst/server/internal/platform/jobs"
	"github.com/aedst/server/internal/platform/push"
	"github.com/aedst/server/internal/platform/retention"
	"github.com/aedst/server/internal/platform/search"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// Module is one registered business module. Only Name is required; every hook
// is optional so a stateless module declares just what it has.
type Module struct {
	// Name is the directory name under internal/modules (architecturetest checks it).
	Name string
	// Requires are modules whose Setup must run first (their Provide calls are
	// then visible). A missing name fails startup.
	Requires []string
	// Files are the protobuf files of the services this module mounts. They feed
	// role-policy validation and "mounted service is known" verification.
	Files []protoreflect.FileDescriptor
	// Public lists procedures ("/pkg.Service/Method") reachable without a token.
	// They are also covered by the unauthenticated per-IP rate limit.
	Public []string
	// Roles is the module's built-in role policy ("/pkg.Service/*": roles), the
	// default overlaid by AEDST_ROLE_POLICY.
	Roles map[string][]string
	// Retention returns the purge policies of the module's append-only tables. It
	// runs before the River client exists: Env.Jobs and Env.Publisher are nil, and
	// a Purge that needs something built in Setup must read it lazily.
	Retention func(env *Env) []retention.Policy
	// Setup builds the module's services and registers its River workers and
	// event consumers (Env.Workers, Env.Events), then publishes what other
	// modules may use with Provide.
	Setup func(ctx context.Context, env *Env) error
	// Mount mounts the module's Connect services with Mount (never directly).
	Mount func(env *Env, m *Mounter) error
	// Remote binds the api/ interfaces this unit provides to Connect clients of
	// its network address, for a process that does not host it (see Select). It
	// runs instead of Setup, before any Setup, and calls Provide with the same
	// interface types Setup would. Only a unit whose api/ is network-safe declares
	// one (architecturetest checks the interfaces it provides).
	Remote func(env *Env, target RemoteTarget) error
	// Consumes statically declares every integration event this unit subscribes
	// to (the same set its infrastructure/events passes to Registry.Subscribe;
	// architecturetest compares the two). A process that does not host the unit
	// registers them as remote consumers, so its producers still insert the
	// deliveries the unit's own process works from its queue.
	Consumes []Consume
}

// Consume is one event subscription of a unit.
type Consume struct {
	// EventType is the event's type, e.g. tasksapi.TaskCompletedEventType.
	EventType string
	// Consumer is the stable consumer name "<unit>.<name>" (a feature's "/" is
	// written "_"); it is stored in job args and must never be renamed.
	Consumer string
}

var (
	mu       sync.Mutex
	registry = map[string]Module{}
)

// Register adds a module. It panics on a duplicate or empty name: that is a
// programming error found by any test run, not a runtime condition.
func Register(m Module) {
	mu.Lock()
	defer mu.Unlock()
	if m.Name == "" {
		panic("modulekit: module without a name")
	}
	if _, dup := registry[m.Name]; dup {
		panic("modulekit: module registered twice: " + m.Name)
	}
	registry[m.Name] = m
}

// Names returns the registered module names, sorted.
func Names() []string {
	mu.Lock()
	defer mu.Unlock()
	names := make([]string, 0, len(registry))
	for n := range registry {
		names = append(names, n)
	}
	sort.Strings(names)
	return names
}

// Ordered returns the registered modules with every module after the modules it
// requires. Independent modules come out in name order, so startup is
// deterministic. It fails on an unknown requirement or a cycle.
func Ordered() ([]Module, error) {
	mu.Lock()
	defer mu.Unlock()
	return order(registry, nil)
}

// order sorts mods after the units they require. external are units that are
// not in mods but are reachable (remote): a requirement on one is satisfied.
func order(mods, external map[string]Module) ([]Module, error) {
	names := make([]string, 0, len(mods))
	for n := range mods {
		names = append(names, n)
	}
	sort.Strings(names)
	for _, n := range names {
		for _, req := range mods[n].Requires {
			if _, ok := external[req]; ok {
				continue
			}
			if _, ok := mods[req]; !ok {
				return nil, fmt.Errorf("modulekit: module %q requires %q, which is not registered (is its module package imported in cmd/server/modules.go?)", n, req)
			}
		}
	}
	out := make([]Module, 0, len(mods))
	done := map[string]bool{}
	for len(out) < len(names) {
		progressed := false
		for _, n := range names {
			if done[n] || slices.ContainsFunc(mods[n].Requires, func(r string) bool {
				_, remote := external[r]
				return !done[r] && !remote
			}) {
				continue
			}
			done[n] = true
			out = append(out, mods[n])
			progressed = true
		}
		if !progressed {
			return nil, fmt.Errorf("modulekit: dependency cycle among modules %v", pending(names, done))
		}
	}
	return out, nil
}

func pending(names []string, done map[string]bool) []string {
	var left []string
	for _, n := range names {
		if !done[n] {
			left = append(left, n)
		}
	}
	return left
}

// Env is what the composition root hands every module: configuration and the
// platform components it built. Fields that depend on later startup steps are
// documented; modules read an Env, they never construct platform components.
type Env struct {
	Config config.Config
	Logger *slog.Logger
	Clock  sharedtime.Clock

	// Pool serves requests; JobsPool serves River workers and event consumers.
	Pool, JobsPool *pgxpool.Pool
	// JobStats is the queue read-model over the jobs pool (admin dashboards); it
	// needs no River client, so it exists in Retention too.
	JobStats platformjobs.Stats
	// ReadPool serves queries that tolerate replica lag (projections, lists
	// nobody reads their own write from). It is the same pool as Pool unless
	// AEDST_DATABASE_READ_URL is set. Never use it inside a transaction that
	// writes, or for read-your-writes.
	ReadPool    *pgxpool.Pool
	RateLimiter *cache.RateLimiter

	// Search is the engine port (search.Disabled when unconfigured); modules
	// register an index Source on SearchSources from Setup and enqueue syncs with
	// Indexer.EnqueueTx (nil in Retention). Flags evaluates feature flags and
	// returns the caller's default when none is configured.
	Search        search.Engine
	SearchSources *search.Registry
	Indexer       *search.Indexer
	Flags         flags.Flags

	Dispatcher *push.Dispatcher
	WebPushKey string

	// Workers, Events, Jobs and Publisher exist from Setup on (Jobs and
	// Publisher are nil in Retention).
	Workers   *river.Workers
	Events    *events.Registry
	Jobs      *platformjobs.Client
	Publisher events.Publisher

	services        map[reflect.Type]any
	modulePools     map[string]*pgxpool.Pool
	moduleJobsPools map[string]*pgxpool.Pool
	closers         []func()
}

// OnClose registers a cleanup for a resource a module's Setup opened (a client,
// a library lifecycle). Close runs them in reverse order, like stacked defers.
func (e *Env) OnClose(f func()) { e.closers = append(e.closers, f) }

// Close runs the registered cleanups.
func (e *Env) Close() {
	for _, v := range slices.Backward(e.closers) {
		v()
	}
	e.closers = nil
}

// Provide publishes v under the interface type T (an api/ type) for modules that
// list this module in Requires. A second Provide for the same T replaces it.
func Provide[T any](e *Env, v T) {
	if e.services == nil {
		e.services = map[reflect.Type]any{}
	}
	e.services[reflect.TypeFor[T]()] = v
}

// Lookup returns what a required module provided as T, if it did.
func Lookup[T any](e *Env) (T, bool) {
	v, ok := e.services[reflect.TypeFor[T]()].(T)
	return v, ok
}

// Require is Lookup that fails with a clear startup error.
func Require[T any](e *Env) (T, error) {
	v, ok := Lookup[T](e)
	if !ok {
		return v, fmt.Errorf("modulekit: no module provided %s (add its module to Requires and check its Setup)", reflect.TypeFor[T]())
	}
	return v, nil
}

// PoolFor is module's request pool: its own database when AEDST_DATABASE_URL_<MODULE>
// is set (database-per-module), otherwise the shared Pool. A module that may be
// extracted asks for its pools through PoolFor/JobsPoolFor, never Env.Pool, so
// splitting its data later is configuration, not code.
func (e *Env) PoolFor(module string) *pgxpool.Pool {
	if p, ok := e.modulePools[module]; ok {
		return p
	}
	return e.Pool
}

// JobsPoolFor is module's background pool (River handlers, retention): its
// AEDST_DATABASE_URL_<MODULE>_JOBS, else its request database's own jobs pool, else
// the shared JobsPool.
func (e *Env) JobsPoolFor(module string) *pgxpool.Pool {
	if p, ok := e.moduleJobsPools[module]; ok {
		return p
	}
	return e.JobsPool
}

// SetModulePools registers module's own pools (cmd/server, from the
// AEDST_DATABASE_URL_<MODULE> overrides). A nil pool keeps the shared one.
func (e *Env) SetModulePools(module string, api, jobs *pgxpool.Pool) {
	if e.modulePools == nil {
		e.modulePools, e.moduleJobsPools = map[string]*pgxpool.Pool{}, map[string]*pgxpool.Pool{}
	}
	if api != nil {
		e.modulePools[module] = api
	}
	if jobs != nil {
		e.moduleJobsPools[module] = jobs
	}
}
