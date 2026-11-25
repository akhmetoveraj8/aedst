package main

import (
	"context"
	"log/slog"
	"time"

	platformauth "github.com/aedst/server/internal/platform/auth"
)

// buildVerifier wires the OIDC resource-server verifier (ADR-0019): the only
// authentication back-end. Discovery and the first JWKS fetch are warmed in the
// background; the server boots while the identity provider is down and rejects
// tokens until it is reachable (retried on use, at most once per backoff).
func (a *app) buildVerifier(ctx context.Context) error {
	cfg := a.cfg
	verifier, err := platformauth.NewOIDCVerifier(platformauth.OIDCConfig{
		Issuer:     cfg.OIDC.Issuer,
		Audience:   cfg.OIDC.Audience,
		JWKSURL:    cfg.OIDC.JWKSURL,
		Algorithms: cfg.OIDC.Algorithms,
		TokenTypes: cfg.OIDC.TokenTypes,
		RolesClaim: cfg.OIDC.RolesClaim,
		RolesOrg:   cfg.OIDC.RolesOrg,
		ClockSkew:  time.Duration(cfg.OIDC.ClockSkewSeconds) * time.Second,

		TenantClaim:    cfg.OIDC.TenantClaim,
		TenantRequired: cfg.OIDC.TenantRequired,
	})
	if err != nil {
		return err
	}
	// Closed with the other resources once the HTTP server has drained; Close
	// also cancels a warm-up still in flight.
	a.onClose(func() { _ = verifier.Close(context.WithoutCancel(ctx)) })
	a.verifier = verifier
	go func() {
		if err := verifier.Warm(ctx); err != nil {
			a.logger.WarnContext(ctx, "oidc warm-up failed; tokens are rejected until the provider is reachable",
				slog.String("issuer", verifier.Issuer()), slog.Any("error", err))
		}
	}()
	return nil
}
