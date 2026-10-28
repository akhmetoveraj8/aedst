// Package module registers the capabilities module with the composition root
// (internal/platform/modulekit). It is stateless: it needs no tables, jobs or
// other modules, only configuration.
package module

import (
	"context"

	"google.golang.org/protobuf/reflect/protoreflect"

	capabilitiesv1 "github.com/aedst/server/gen/go/aedst/capabilities/v1"
	capabilitiesv1connect "github.com/aedst/server/gen/go/aedst/capabilities/v1/capabilitiesv1connect"
	capabilitiesapi "github.com/aedst/server/internal/modules/capabilities/api"
	"github.com/aedst/server/internal/modules/capabilities/application"
	"github.com/aedst/server/internal/modules/capabilities/transport"
	"github.com/aedst/server/internal/platform/buildinfo"
	"github.com/aedst/server/internal/platform/modulekit"
)

const smallRequestBytes = 4 << 10 // the request message is empty

func init() {
	m := &capabilitiesModule{}
	modulekit.Register(modulekit.Module{
		Name:  "capabilities",
		Files: []protoreflect.FileDescriptor{capabilitiesv1.File_aedst_capabilities_v1_capabilities_proto},
		// Clients must be able to learn they need an update before they can sign in.
		Public: []string{capabilitiesv1connect.CapabilitiesServiceGetCapabilitiesProcedure},
		Setup:  m.setup,
		Mount:  m.mount,
	})
}

type capabilitiesModule struct{ svc capabilitiesapi.Service }

func (m *capabilitiesModule) setup(_ context.Context, env *modulekit.Env) error {
	policy, err := buildPolicy(env.Config, buildinfo.Get(), modulekit.Names())
	if err != nil {
		return err
	}
	m.svc = application.NewService(policy)
	return nil
}

func (m *capabilitiesModule) mount(_ *modulekit.Env, mt *modulekit.Mounter) error {
	modulekit.Mount(mt, capabilitiesv1connect.RegisterCapabilitiesServiceHandler, capabilitiesv1connect.CapabilitiesServiceHandler(transport.NewHandler(m.svc)), smallRequestBytes)
	return nil
}
