package flags

import (
	"fmt"

	flagd "github.com/open-feature/go-sdk-contrib/providers/flagd/pkg"
	"github.com/open-feature/go-sdk/openfeature"
)

// FlagdConfig points at a flagd instance (a sidecar or the chart's Service).
type FlagdConfig struct {
	Host string
	Port uint16
}

// NewFlagd builds the flagd provider over its gRPC evaluation API with the
// SDK's LRU result cache. Flag definitions live with flagd (Helm: flags.*), not
// in this process.
func NewFlagd(cfg FlagdConfig) (openfeature.FeatureProvider, error) {
	opts := []flagd.ProviderOption{flagd.WithRPCResolver(), flagd.WithLRUCache(1000)}
	if cfg.Host != "" {
		opts = append(opts, flagd.WithHost(cfg.Host))
	}
	if cfg.Port != 0 {
		opts = append(opts, flagd.WithPort(cfg.Port))
	}
	p, err := flagd.NewProvider(opts...)
	if err != nil {
		return nil, fmt.Errorf("flags: flagd provider: %w", err)
	}
	return p, nil
}
