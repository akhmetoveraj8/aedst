package main

import (
	"context"
	"fmt"
	"maps"

	"google.golang.org/protobuf/reflect/protoreflect"

	eventsv1 "github.com/aedst/server/gen/go/aedst/events/v1"
	eventsv1connect "github.com/aedst/server/gen/go/aedst/events/v1/eventsv1connect"
	"github.com/aedst/server/internal/platform/events/ingest"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/platform/modulekit"
)

// bindRemoteModules runs the Remote hook of every unit this process does not host
// but a hosted unit requires: it provides the unit's api/ interfaces as network
// clients, so the Setup of the units that Require them is unchanged.
func (a *app) bindRemoteModules(context.Context) error {
	for _, m := range a.remote {
		target := modulekit.RemoteTarget{Name: m.Name, BaseURL: a.cfg.Topology.Remote[m.Name]}
		if err := m.Remote(a.env, target); err != nil {
			return fmt.Errorf("module %s: remote %s: %w", m.Name, target.BaseURL, err)
		}
	}
	return nil
}

// wireModules runs every registered module's Setup in dependency order. The
// River client and event publisher exist by now (buildJobs), so a module can
// insert jobs and register workers and event consumers.
func (a *app) wireModules(ctx context.Context) error {
	for _, m := range a.mods {
		if m.Setup == nil {
			continue
		}
		if err := m.Setup(ctx, a.env); err != nil {
			return fmt.Errorf("module %s: %w", m.Name, err)
		}
	}
	return nil
}

// eventIngestPolicy is the role-policy key of EventIngestService (every procedure).
const eventIngestPolicy = "/aedst.events.v1.EventIngestService/*"

// ingestRequestBytes caps one forwarded event (payload up to 256 KiB plus the envelope).
const ingestRequestBytes = 320 << 10

// mountEventIngest mounts EventIngestService when AEDST_EVENTS_INGEST_ENABLED is set:
// the endpoint a producer in another service calls to hand over a delivery. It inserts
// into this process's own database through its own River client.
func (a *app) mountEventIngest(rpc *modulekit.Mounter) {
	if !a.cfg.Events.IngestEnabled {
		return
	}
	modulekit.Mount(rpc, eventsv1connect.RegisterEventIngestServiceHandler,
		eventsv1connect.EventIngestServiceHandler(ingest.NewHandler(a.env.Events, a.env.Jobs)), ingestRequestBytes)
}

// mountModules mounts every module's API services through the one sanctioned
// mounter (modulekit.Mount).
func (a *app) mountModules(rpc *modulekit.Mounter) error {
	for _, m := range a.mods {
		if m.Mount == nil {
			continue
		}
		if err := m.Mount(a.env, rpc); err != nil {
			return fmt.Errorf("module %s: mount: %w", m.Name, err)
		}
	}
	a.mountEventIngest(rpc)
	return nil
}

// cachePolicies merges the reads the modules marked cacheable and validates them
// against the descriptors: an unknown procedure, an RPC that is not declared
// NO_SIDE_EFFECTS or a shared cache on a non-public procedure fails startup.
func (a *app) cachePolicies(public map[string]bool) (map[string]httpserver.CachePolicy, error) {
	policies := map[string]httpserver.CachePolicy{}
	var files []protoreflect.FileDescriptor
	for _, m := range a.mods {
		maps.Copy(policies, m.Cacheable)
		files = append(files, m.Files...)
	}
	return policies, httpserver.ValidateCachePolicy(policies, public, files...)
}

// procedureLimits merges the modules' built-in per-procedure rate limits with
// AEDST_PROCEDURE_RATE_LIMITS and validates the result against the procedures
// that exist, so a typo fails the deploy instead of limiting nothing.
func (a *app) procedureLimits(known, public map[string]bool) (map[string]httpserver.ProcedureLimit, error) {
	defaults := map[string]httpserver.ProcedureLimit{}
	for _, m := range a.mods {
		if m.RateLimits != nil {
			maps.Copy(defaults, m.RateLimits(a.cfg))
		}
	}
	configured, err := httpserver.ParseProcedureLimits(a.cfg.HTTP.ProcedureRateLimits)
	if err != nil {
		return nil, err
	}
	limits := httpserver.MergeProcedureLimits(defaults, configured)
	return limits, httpserver.ValidateProcedureLimits(limits, known, public)
}

// rpcSurface merges what the modules declare about their RPCs: the procedures
// reachable without a token, the built-in role policy, and every procedure that
// exists (from the protobuf files, to validate AEDST_ROLE_POLICY against).
func (a *app) rpcSurface() (public map[string]bool, defaultRoles map[string][]string, known map[string]bool) {
	public, defaultRoles = map[string]bool{}, map[string][]string{}
	var files []protoreflect.FileDescriptor
	for _, m := range a.mods {
		for _, p := range m.Public {
			public[p] = true
		}
		maps.Copy(defaultRoles, m.Roles)
		files = append(files, m.Files...)
	}
	if a.cfg.Events.IngestEnabled {
		// The ingest endpoint is closed to users: only the machine identity may call it.
		defaultRoles[eventIngestPolicy] = []string{"internal"}
		files = append(files, eventsv1.File_aedst_events_v1_events_proto)
	}
	return public, defaultRoles, httpserver.ProceduresOf(files...)
}
