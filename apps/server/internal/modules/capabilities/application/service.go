// Package application answers capability negotiation from an immutable policy
// built at start-up; nothing here touches a database.
package application

import (
	"context"
	"maps"

	"github.com/aedst/server/internal/modules/capabilities/domain"
)

// Policy is what the server advertises. The composition (module package)
// derives it from configuration once; Service never mutates it.
type Policy struct {
	ServerVersion string
	Clients       map[string]domain.ClientVersions
	Features      map[string]domain.Feature
}

type Service struct{ policy Policy }

func NewService(p Policy) *Service { return &Service{policy: p} }

// Get returns the capabilities for a caller. clientPlatform and clientVersion
// come from the X-Aedst-Client header (version with a leading "v"); both are
// empty when the caller did not identify itself. The result is a copy: callers
// may keep or modify it.
func (s *Service) Get(_ context.Context, clientPlatform, clientVersion string) (domain.Capabilities, error) {
	out := domain.Capabilities{
		ServerVersion: s.policy.ServerVersion,
		Clients:       maps.Clone(s.policy.Clients),
		Features:      make(map[string]domain.Feature, len(s.policy.Features)),
	}
	for name, f := range s.policy.Features {
		f.Params = maps.Clone(f.Params)
		out.Features[name] = f
	}
	if window, ok := s.policy.Clients[clientPlatform]; ok && clientVersion != "" {
		out.Status = domain.StatusOf(clientVersion, window)
	}
	return out, nil
}
