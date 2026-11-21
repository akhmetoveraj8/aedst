package module

import (
	"context"
	"net/http"
	"net/http/httptest"
	"slices"
	"strings"
	"sync"
	"testing"

	tasksv1connect "github.com/aedst/server/gen/go/aedst/tasks/v1/tasksv1connect"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/modules/tasks/api/ownershiptest"
	"github.com/aedst/server/internal/platform/config"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/shared/ids"
)

// The extraction proof without a database: two processes built from the same
// registry by environment alone (AEDST_MODULES, AEDST_MODULE_<NAME>_URL), the
// way cmd/server builds them, with a call between them that really crosses
// HTTP through the generated Connect client. Only storage is replaced (an
// in-memory tasks service); the two-real-servers-on-Postgres version is
// cmd/server's TestExtraction_MediaReachesTasksInAnotherProcess (integration).

// ownershipConsumer stands in for a unit that needs tasks' Ownership contract
// (media in the real binary; this test binary links only tasks). It is a
// registered unit, so the topology treats it exactly like one.
const ownershipConsumer = "ownershipconsumer"

var consumed struct {
	sync.Mutex
	own tasksapi.Ownership
}

func init() {
	modulekit.Register(modulekit.Module{
		Name:     ownershipConsumer,
		Requires: []string{"tasks"},
		Setup: func(_ context.Context, env *modulekit.Env) error {
			own, err := modulekit.Require[tasksapi.Ownership](env)
			consumed.Lock()
			consumed.own = own
			consumed.Unlock()
			return err
		},
	})
}

// planFromEnv resolves the topology of one process from its environment, the
// first thing cmd/server's run does (config.Load, then modulekit.Select).
func planFromEnv(t *testing.T, env map[string]string) (config.Config, modulekit.Plan) {
	t.Helper()
	t.Setenv("AEDST_ENV", "test")
	// Required by Load; nothing in this test dials either of them.
	t.Setenv("AEDST_DATABASE_URL", "postgres://never-dialed.invalid/aedst")
	t.Setenv("AEDST_OIDC_ISSUER", "https://never-dialed.invalid")
	t.Setenv("AEDST_OIDC_AUDIENCE", "aedst-test")
	for _, name := range []string{"AEDST_MODULES", "AEDST_MODULE_TASKS_URL"} {
		t.Setenv(name, env[name])
	}
	cfg, err := config.Load()
	if err != nil {
		t.Fatalf("config.Load: %v", err)
	}
	plan, err := modulekit.Select(cfg.Topology.Enabled, cfg.Topology.Remote)
	if err != nil {
		t.Fatalf("modulekit.Select: %v", err)
	}
	return cfg, plan
}

func names(mods []modulekit.Module) []string {
	out := make([]string, len(mods))
	for i, m := range mods {
		out[i] = m.Name
	}
	return out
}

func TestExtraction_ACallCrossesTheNetworkBetweenTwoProcesses(t *testing.T) {
	alice, bob := ids.New(), ids.New()
	aliceTask, bobTask := ids.New(), ids.New()

	// Process A: AEDST_MODULES=tasks. It hosts tasks and nothing else, and serves
	// the module's real TasksService handler (both features, composed) through the
	// one sanctioned mounter.
	_, planA := planFromEnv(t, map[string]string{"AEDST_MODULES": "tasks"})
	if got := planA.Names(); !slices.Equal(got, []string{"tasks"}) || len(planA.Remote) != 0 {
		t.Fatalf("process A hosts %v with %d remote units, want only tasks", got, len(planA.Remote))
	}
	var seen struct {
		sync.Mutex
		paths  []string
		bearer []string
	}
	mux := http.NewServeMux()
	mt := modulekit.NewMounter(mux, nil, nil, requestBytes, true)
	modulekit.Mount(mt, tasksv1connect.RegisterTasksServiceHandler,
		newTasksHandler(ownershiptest.Service{Owned: map[ids.ID]ids.ID{aliceTask: alice, bobTask: bob}}), requestBytes)
	processA := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		seen.Lock()
		seen.paths = append(seen.paths, r.Method+" "+r.URL.Path)
		seen.bearer = append(seen.bearer, r.Header.Get("Authorization"))
		seen.Unlock()
		authenticate(mux).ServeHTTP(w, r)
	}))
	t.Cleanup(processA.Close)

	// Process B: AEDST_MODULES=<the consumer>, AEDST_MODULE_TASKS_URL=<process A>.
	// It does not host tasks, so tasks' Remote hook runs instead of its Setup and
	// the consumer's Setup is unchanged (cmd/server: bindRemoteModules, wireModules).
	cfgB, planB := planFromEnv(t, map[string]string{"AEDST_MODULES": ownershipConsumer, "AEDST_MODULE_TASKS_URL": processA.URL})
	if planB.Hosts("tasks") || !slices.Equal(planB.Names(), []string{ownershipConsumer}) || !slices.Equal(names(planB.Remote), []string{"tasks"}) {
		t.Fatalf("process B hosts %v and reaches %v, want to host only the consumer and reach tasks", planB.Names(), names(planB.Remote))
	}
	envB := &modulekit.Env{Config: cfgB}
	for _, m := range planB.Remote {
		// No HTTPClient override: the production client (deadline, breaker, rate limit, tracing).
		if err := m.Remote(envB, modulekit.RemoteTarget{Name: m.Name, BaseURL: cfgB.Topology.Remote[m.Name]}); err != nil {
			t.Fatalf("remote %s: %v", m.Name, err)
		}
	}
	for _, m := range planB.Local {
		if err := m.Setup(context.Background(), envB); err != nil {
			t.Fatalf("setup %s: %v", m.Name, err)
		}
	}
	consumed.Lock()
	own := consumed.own
	consumed.Unlock()

	if ok, err := own.OwnsTask(asUser(alice), alice, aliceTask); err != nil || !ok {
		t.Fatalf("alice owns her task: got %v, %v", ok, err)
	}
	if ok, err := own.OwnsTask(asUser(alice), alice, bobTask); err != nil || ok {
		t.Fatalf("alice does not own bob's task: got %v, %v (existence must not leak as an error)", ok, err)
	}

	seen.Lock()
	defer seen.Unlock()
	want := "POST " + tasksv1connect.TasksServiceGetTaskProcedure
	if !slices.Equal(seen.paths, []string{want, want}) {
		t.Fatalf("process A saw %v, want two %q requests: the calls did not cross the network", seen.paths, want)
	}
	if seen.bearer[0] != "Bearer "+alice.String() {
		t.Fatalf("process A saw Authorization %q: the caller's token was not forwarded", seen.bearer[0])
	}

	// The same consumer in the monolith (no topology variables): tasks is hosted,
	// no Remote hook runs, and nothing would leave the process.
	_, mono := planFromEnv(t, nil)
	if !mono.Hosts("tasks") || !mono.Hosts(ownershipConsumer) || len(mono.Remote) != 0 {
		t.Fatalf("monolith hosts %v with %d remote units, want everything local", mono.Names(), len(mono.Remote))
	}
}

// A process that needs tasks but neither hosts it nor knows where it lives must
// refuse to start and name the variable to set.
func TestExtraction_MissingURLFailsAtStartup(t *testing.T) {
	_, err := modulekit.Select([]string{ownershipConsumer}, nil)
	if err == nil {
		t.Fatal("Select succeeded for a consumer whose requirement is neither hosted nor reachable")
	}
	if msg := err.Error(); !strings.Contains(msg, `"tasks"`) || !strings.Contains(msg, "AEDST_MODULE_TASKS_URL") {
		t.Fatalf("error %q does not name the unit and the variable", msg)
	}
}
