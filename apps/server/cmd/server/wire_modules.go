package main

import (
	"context"
	"fmt"
	"maps"

	"google.golang.org/protobuf/reflect/protoreflect"

	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/platform/modulekit"
)

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
	return nil
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
	return public, defaultRoles, httpserver.ProceduresOf(files...)
}
