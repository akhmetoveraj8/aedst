package main

import (
	"context"
	"time"

	platformauth "github.com/aedst/server/internal/platform/auth"
)

// buildVerifier wires the OIDC resource-server verifier (ADR-0019): the only
// authentication back-end. Discovery is lazy, so the server boots while the
// identity provider is down and rejects tokens until it is reachable.
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
	})
	if err != nil {
		return err
	}
	a.onClose(func() { _ = verifier.Close(context.WithoutCancel(ctx)) })
	a.verifier = verifier
	return nil
}
