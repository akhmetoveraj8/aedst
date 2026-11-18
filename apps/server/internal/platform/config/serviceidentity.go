package config

import (
	"net/url"
	"slices"
)

// ServiceIdentityConfig is the machine identity of this process: an OIDC
// client-credentials client the server uses for a call that has no user behind it
// (the admin.apply job calling another unit's operator service, ADR-0020 section 5).
// It is optional: with no token URL the process has no service identity and an
// operator mutation on a unit hosted elsewhere is refused up front, as before.
// The identity provider must grant this client the "internal" role (docs/content/server/runbook-extract-service.md, step 8).
type ServiceIdentityConfig struct {
	// TokenURL is the provider's token endpoint (ZITADEL: <issuer>/oauth/v2/token).
	TokenURL string `env:"AEDST_SERVICE_IDENTITY_TOKEN_URL" envDefault:""`
	// ClientID and ClientSecret authenticate the client (HTTP Basic, RFC 6749 2.3.1).
	ClientID     string `env:"AEDST_SERVICE_IDENTITY_CLIENT_ID" envDefault:""`
	ClientSecret string `env:"AEDST_SERVICE_IDENTITY_CLIENT_SECRET" envDefault:""`
	// Scopes are requested with the grant. They must make the access token pass
	// this server's own verification (audience, roles claim), e.g. for ZITADEL
	// "openid urn:zitadel:iam:org:project:id:<project>:aud urn:zitadel:iam:org:projects:roles".
	Scopes []string `env:"AEDST_SERVICE_IDENTITY_SCOPES" envSeparator:"," envDefault:""`
}

// Enabled reports whether a service identity is configured.
func (c ServiceIdentityConfig) Enabled() bool { return c.TokenURL != "" }

func (c Config) validateServiceIdentity(bad func(string, ...any)) {
	s := c.ServiceIdentity
	if s.TokenURL == "" {
		if s.ClientID != "" || s.ClientSecret != "" || len(s.Scopes) > 0 {
			bad("AEDST_SERVICE_IDENTITY_CLIENT_ID, _CLIENT_SECRET and _SCOPES need AEDST_SERVICE_IDENTITY_TOKEN_URL")
		}
		return
	}
	if s.ClientID == "" || s.ClientSecret == "" {
		bad("AEDST_SERVICE_IDENTITY_TOKEN_URL requires AEDST_SERVICE_IDENTITY_CLIENT_ID and AEDST_SERVICE_IDENTITY_CLIENT_SECRET")
	}
	u, err := url.Parse(s.TokenURL)
	switch {
	case err != nil || u.Host == "":
		bad("AEDST_SERVICE_IDENTITY_TOKEN_URL %q is not a valid URL", s.TokenURL)
	case u.Scheme != "https" && (u.Scheme != "http" || c.Env.IsDeployed()):
		bad("AEDST_SERVICE_IDENTITY_TOKEN_URL must use https (http is allowed only outside staging/production)")
	}
	if slices.Contains(s.Scopes, "") {
		bad("AEDST_SERVICE_IDENTITY_SCOPES must not contain an empty scope")
	}
}
