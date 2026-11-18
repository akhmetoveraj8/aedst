package main

import (
	"context"
	"log/slog"
	"time"

	"github.com/aedst/server/internal/platform/flags"
	"github.com/aedst/server/internal/platform/search"
)

// buildSearch wires the search engine port and feature flags. Both are optional
// and fail soft: search falls back to pg_trgm (index jobs are not enqueued) and
// every flag evaluates to its default in code. Neither ever gates startup.
func (a *app) buildSearch(ctx context.Context) error {
	a.env.SearchSources = search.NewRegistry()
	a.env.Search = search.Disabled{}
	if sc := a.cfg.Search; sc.Enabled() {
		a.env.Search = search.NewMeili(search.MeiliConfig{
			URL: sc.URL, APIKey: sc.APIKey, Timeout: time.Duration(sc.TimeoutMs) * time.Millisecond,
		})
	}

	a.env.Flags = flags.Static{}
	if fc := a.cfg.Flags; fc.Enabled() {
		provider, err := flags.NewFlagd(flags.FlagdConfig{Host: fc.FlagdHost, Port: fc.FlagdPort})
		if err != nil {
			a.logger.WarnContext(ctx, "feature flags disabled: flagd provider failed", slog.Any("error", err))
			return nil
		}
		// The flagd provider reconnects on its own; an unreachable flagd must not
		// block startup, so a failed init only logs and flags keep their defaults.
		client, err := flags.New("aedst", provider)
		if err != nil {
			a.logger.WarnContext(ctx, "feature flags unavailable at startup; defaults apply", slog.Any("error", err))
			return nil
		}
		a.env.Flags = client
	}
	return nil
}
