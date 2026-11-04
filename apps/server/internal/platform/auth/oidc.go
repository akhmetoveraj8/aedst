package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jwx-go/jwkfetch/v4"
	"github.com/lestrrat-go/httprc/v3"
	"github.com/lestrrat-go/jwx/v4/jwk"
	"github.com/lestrrat-go/jwx/v4/jws"
	"github.com/lestrrat-go/jwx/v4/jwt"

	"github.com/aedst/server/internal/shared/ids"
)

// OIDCConfig configures an OIDCVerifier. Everything is supplied by
// configuration; there is no provider-specific behaviour.
type OIDCConfig struct {
	Issuer     string
	Audience   string
	JWKSURL    string   // optional override of discovery's jwks_uri
	Algorithms []string // allow-list, asymmetric only
	// TokenTypes is the allow-list of the JOSE header `typ` of an access token,
	// compared case-insensitively without an "application/" prefix: RFC 9068
	// access tokens carry "at+jwt"; some providers (Keycloak) send "JWT". A token
	// with a typ outside the list, or without one, is rejected. Empty = at+jwt, JWT.
	TokenTypes []string
	RolesClaim string
	// RolesOrg restricts an object-shaped roles claim ({role: {orgId: domain}},
	// ZITADEL) to roles granted in this organisation id. Empty = any. It has no
	// effect on array or string claims, which carry no organisation.
	RolesOrg  string
	ClockSkew time.Duration
	// HTTPClient is used for discovery; JWKS fetching uses jwkfetch's hardened
	// default client. nil means a client with a 10s timeout.
	HTTPClient *http.Client
}

// ErrOIDCUnavailable is returned when discovery/JWKS could not be loaded; the
// caller should treat it as "cannot verify right now" (fail closed).
var ErrOIDCUnavailable = errors.New("auth: oidc provider unavailable")

const (
	discoveryRetryBackoff = 5 * time.Second
	forcedRefreshInterval = time.Minute
)

// OIDCVerifier validates access tokens from an external OpenID Connect
// provider, making this server an OIDC resource server. Discovery is lazy
// (so the server boots while the IdP is down and simply rejects tokens until
// it is reachable); signing keys are cached and refreshed in the background
// by jwkfetch, with one rate-limited forced refresh when an unknown key id
// shows up (key rotation).
type OIDCVerifier struct {
	cfg  OIDCConfig
	http *http.Client
	algs []string

	mu            sync.Mutex
	cache         *jwkfetch.Cache
	jwksURL       string
	lastAttempt   time.Time
	lastForcedRef time.Time
}

func NewOIDCVerifier(cfg OIDCConfig) (*OIDCVerifier, error) {
	if cfg.Issuer == "" || cfg.Audience == "" {
		return nil, errors.New("auth: oidc issuer and audience are required")
	}
	if len(cfg.TokenTypes) == 0 {
		cfg.TokenTypes = []string{"at+jwt", "JWT"}
	}
	if len(cfg.Algorithms) == 0 {
		return nil, errors.New("auth: oidc algorithm allow-list is empty")
	}
	client := cfg.HTTPClient
	if client == nil {
		client = &http.Client{Timeout: 10 * time.Second}
	}
	if cfg.RolesClaim == "" {
		cfg.RolesClaim = "roles"
	}
	return &OIDCVerifier{cfg: cfg, http: client, algs: cfg.Algorithms}, nil
}

// Issuer returns the configured issuer, for diagnostics.
func (v *OIDCVerifier) Issuer() string { return v.cfg.Issuer }

// Close stops the background JWKS refresher.
func (v *OIDCVerifier) Close(ctx context.Context) error {
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.cache == nil {
		return nil
	}
	if err := v.cache.Shutdown(ctx); err != nil {
		return fmt.Errorf("auth: stop jwks cache: %w", err)
	}
	return nil
}

// Ready reports whether discovery and the first JWKS fetch have succeeded;
// used by /readyz-style diagnostics (not by liveness).
func (v *OIDCVerifier) Ready() bool {
	v.mu.Lock()
	defer v.mu.Unlock()
	return v.cache != nil
}

// VerifyAccessToken verifies signature, algorithm allow-list, issuer,
// audience and time claims, then maps the token to Claims.
func (v *OIDCVerifier) VerifyAccessToken(ctx context.Context, raw string) (Claims, error) {
	if looksOpaque(raw) {
		return Claims{}, ErrOpaqueToken
	}
	if err := v.checkHeader(raw); err != nil {
		return Claims{}, err
	}

	set, err := v.keySet(ctx)
	if err != nil {
		return Claims{}, err
	}

	token, err := v.parse(raw, set)
	if err != nil && v.refreshOnUnknownKey(ctx, raw, set) {
		if set, rerr := v.keySet(ctx); rerr == nil {
			token, err = v.parse(raw, set)
		}
	}
	if err != nil {
		return Claims{}, fmt.Errorf("auth: verify oidc token: %w", err)
	}

	if err := rejectNonAccessToken(token); err != nil {
		return Claims{}, err
	}
	subject, _ := token.Subject()
	if subject == "" {
		return Claims{}, errors.New("auth: oidc token has no subject")
	}

	sessionID, _ := ids.Parse(stringField(token, claimSessionID))
	return Claims{
		Issuer:    v.cfg.Issuer,
		Subject:   subject,
		UserID:    ids.FromExternal(v.cfg.Issuer, subject),
		SessionID: sessionID,
		Roles:     rolesFromToken(token, v.cfg.RolesClaim, v.cfg.RolesOrg),
	}, nil
}

func (v *OIDCVerifier) parse(raw string, set jwk.Set) (jwt.Token, error) {
	token, err := jwt.Parse([]byte(raw),
		jwt.WithKeySet(set, jws.WithInferAlgorithmFromKey(true)),
		jwt.WithValidate(true),
		jwt.WithIssuer(v.cfg.Issuer),
		jwt.WithAudience(v.cfg.Audience),
		jwt.WithAcceptableSkew(v.cfg.ClockSkew),
	)
	if err != nil {
		return nil, fmt.Errorf("parse: %w", err)
	}
	return token, nil
}

// keySet returns the cached JWKS, performing discovery on first use (and
// after failures, at most once per discoveryRetryBackoff).
func (v *OIDCVerifier) keySet(ctx context.Context) (jwk.Set, error) {
	v.mu.Lock()
	defer v.mu.Unlock()

	if v.cache == nil {
		if time.Since(v.lastAttempt) < discoveryRetryBackoff {
			return nil, ErrOIDCUnavailable
		}
		v.lastAttempt = time.Now()
		if err := v.initLocked(ctx); err != nil {
			return nil, fmt.Errorf("%w: %w", ErrOIDCUnavailable, err)
		}
	}
	set, err := v.cache.CachedSet(v.jwksURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrOIDCUnavailable, err)
	}
	return set, nil
}

func (v *OIDCVerifier) initLocked(ctx context.Context) error {
	jwksURL := v.cfg.JWKSURL
	if jwksURL == "" {
		var err error
		if jwksURL, err = v.discoverJWKSURL(ctx); err != nil {
			return err
		}
	}

	cache, err := jwkfetch.NewCache(ctx, httprc.NewClient())
	if err != nil {
		return fmt.Errorf("new jwks cache: %w", err)
	}
	if err := cache.Register(ctx, jwksURL, jwkfetch.WithMinInterval(5*time.Minute), jwkfetch.WithMaxInterval(time.Hour)); err != nil {
		_ = cache.Shutdown(ctx)
		return fmt.Errorf("register jwks %s: %w", jwksURL, err)
	}
	v.cache, v.jwksURL = cache, jwksURL
	return nil
}

func (v *OIDCVerifier) discoverJWKSURL(ctx context.Context) (string, error) {
	url := strings.TrimRight(v.cfg.Issuer, "/") + "/.well-known/openid-configuration"
	req, err := http.NewRequestWithContext(ctx, http.MethodGet, url, nil)
	if err != nil {
		return "", fmt.Errorf("build discovery request: %w", err)
	}
	resp, err := v.http.Do(req)
	if err != nil {
		return "", fmt.Errorf("discovery request: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	if resp.StatusCode != http.StatusOK {
		return "", fmt.Errorf("discovery returned %s", resp.Status)
	}

	var doc struct {
		Issuer  string `json:"issuer"`
		JWKSURI string `json:"jwks_uri"`
	}
	if err := json.NewDecoder(io.LimitReader(resp.Body, 1<<20)).Decode(&doc); err != nil {
		return "", fmt.Errorf("decode discovery document: %w", err)
	}
	// OIDC Discovery §4.3: the issuer in the document MUST match the URL it
	// was fetched from, otherwise a hostile document could redirect trust.
	if strings.TrimRight(doc.Issuer, "/") != strings.TrimRight(v.cfg.Issuer, "/") {
		return "", fmt.Errorf("discovery issuer %q does not match configured issuer", doc.Issuer)
	}
	if doc.JWKSURI == "" {
		return "", errors.New("discovery document has no jwks_uri")
	}
	return doc.JWKSURI, nil
}

// refreshOnUnknownKey forces at most one JWKS refresh per minute when the token
// names a key id (kid) the cached set does not hold: the provider rotated its
// signing key. It decides from the token header and the cached set, not from the
// wording of a verification error, and the one-per-minute limit means a stream of
// garbage tokens with random kids cannot turn into a stream of outbound fetches.
func (v *OIDCVerifier) refreshOnUnknownKey(ctx context.Context, raw string, cached jwk.Set) bool {
	msg, err := jws.Parse([]byte(raw))
	if err != nil || len(msg.Signatures()) != 1 {
		return false
	}
	kid, ok := msg.Signatures()[0].ProtectedHeaders().KeyID()
	if !ok || kid == "" {
		return false
	}
	if _, known := cached.LookupKeyID(kid); known {
		return false // the key is cached: this failure is not about rotation
	}
	v.mu.Lock()
	defer v.mu.Unlock()
	if v.cache == nil || time.Since(v.lastForcedRef) < forcedRefreshInterval {
		return false
	}
	v.lastForcedRef = time.Now()
	_, err = v.cache.Refresh(ctx, v.jwksURL)
	return err == nil
}

// rolesFromToken reads roles from claim (exact name first, then a dotted
// path such as "realm_access.roles"). It understands an array of strings, an
// object keyed by role name (Zitadel), and a space-separated string.
func rolesFromToken(token jwt.Token, claim, org string) []string {
	if v, ok := token.Field(claim); ok {
		return rolesFromValue(v, org)
	}
	if !strings.Contains(claim, ".") {
		return nil
	}
	parts := strings.Split(claim, ".")
	v, ok := token.Field(parts[0])
	if !ok {
		return nil
	}
	for _, p := range parts[1:] {
		m, isMap := v.(map[string]any)
		if !isMap {
			return nil
		}
		if v, ok = m[p]; !ok {
			return nil
		}
	}
	return rolesFromValue(v, org)
}

// rolesFromValue flattens a roles claim. For an object keyed by role name, a
// non-empty org keeps only roles whose value is an object containing that
// organisation id (a role without organisation info is dropped: fail closed).
func rolesFromValue(v any, org string) []string {
	switch vals := v.(type) {
	case []string:
		return vals
	case []any:
		out := make([]string, 0, len(vals))
		for _, item := range vals {
			if s, ok := item.(string); ok {
				out = append(out, s)
			}
		}
		return out
	case map[string]any:
		out := make([]string, 0, len(vals))
		for role, granted := range vals {
			if org != "" {
				orgs, isMap := granted.(map[string]any)
				if _, ok := orgs[org]; !isMap || !ok {
					continue
				}
			}
			out = append(out, role)
		}
		slices.Sort(out)
		return out
	case string:
		return strings.Fields(vals)
	default:
		return nil
	}
}
