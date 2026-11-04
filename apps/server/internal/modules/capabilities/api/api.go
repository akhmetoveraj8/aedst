// Package api is the capabilities module's public boundary. No other module
// consumes it today; clients reach it through CapabilitiesService.
package api

import (
	"context"

	"github.com/aedst/server/internal/modules/capabilities/application"
	"github.com/aedst/server/internal/modules/capabilities/domain"
)

type (
	Capabilities   = domain.Capabilities
	ClientVersions = domain.ClientVersions
	Feature        = domain.Feature
	UpdateStatus   = domain.UpdateStatus
)

const (
	StatusUnknown     = domain.StatusUnknown
	StatusCurrent     = domain.StatusCurrent
	StatusRecommended = domain.StatusRecommended
)

// Service answers capability negotiation. clientVersion has a leading "v".
type Service interface {
	Get(ctx context.Context, clientPlatform, clientVersion string) (Capabilities, error)
}

var _ Service = (*application.Service)(nil)
