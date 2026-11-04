package auth

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"strings"
	"time"

	"github.com/jwx-go/jwkfetch/v4"
	"github.com/lestrrat-go/httprc/v3"
	"github.com/lestrrat-go/jwx/v4/jwk"
	"github.com/lestrrat-go/jwx/v4/jws"
)

const (
	discoveryRetryBackoff = 5 * time.Second
	forcedRefreshInterval = time.Minute
	// initTimeout bounds one discovery + first JWKS fetch attempt. It runs on
	// the verifier's own context, so a caller that stops waiting does not
	// cancel it for the callers sharing it.
	initTimeout = 15 * time.Second
)

// Close stops the background JWKS refresher and cancels an in-flight
// discovery. The verifier rejects every token afterwards.
func (v *OIDCVerifier) Close(ctx context.Context) error {
	v.mu.Lock()
	v.closed = true
	cache := v.cache
	v.cache = nil
	v.mu.Unlock()
	defer v.stop()
	if cache == nil {
		return nil
	}
	if err := cache.Shutdown(ctx); err != nil {
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

// Warm runs discovery and the first JWKS fetch now instead of on the first
// request. Call it in the background at startup: an error is not fatal (the
// IdP may be down; requests retry after discoveryRetryBackoff). ctx bounds only
// how long the caller waits, never the attempt itself.
func (v *OIDCVerifier) Warm(ctx context.Context) error {
	_, err := v.keySet(ctx)
	return err
}

// keySet returns the cached JWKS, performing discovery on first use (and
// after a failure, at most once per discoveryRetryBackoff). No network I/O
// happens under v.mu: concurrent callers share the one in-flight attempt
// (singleflight), each waiting at most until its own ctx is done.
func (v *OIDCVerifier) keySet(ctx context.Context) (jwk.Set, error) {
	v.mu.Lock()
	cache, jwksURL, closed, lastFailure := v.cache, v.jwksURL, v.closed, v.lastFailure
	v.mu.Unlock()

	if cache == nil {
		if closed || time.Since(lastFailure) < discoveryRetryBackoff {
			return nil, ErrOIDCUnavailable
		}
		select {
		case res := <-v.inits.DoChan("init", v.initialize):
			if res.Err != nil {
				return nil, fmt.Errorf("%w: %w", ErrOIDCUnavailable, res.Err)
			}
			cache, jwksURL = res.Val.(initResult).cache, res.Val.(initResult).jwksURL
		case <-ctx.Done():
			return nil, fmt.Errorf("%w: %w", ErrOIDCUnavailable, ctx.Err())
		}
	}
	set, err := cache.CachedSet(jwksURL)
	if err != nil {
		return nil, fmt.Errorf("%w: %w", ErrOIDCUnavailable, err)
	}
	return set, nil
}

type initResult struct {
	cache   *jwkfetch.Cache
	jwksURL string
}

// initialize discovers the JWKS URL and starts the key cache. It runs on
// v.life, never on a request context: httprc ties its backend and worker
// goroutines to the context it is started with, so a request-scoped one would
// stop the refresher when that request ends and leave every later lookup
// blocked on a backend that no longer exists.
func (v *OIDCVerifier) initialize() (any, error) {
	// A caller that saw no cache may start a flight just after another flight
	// succeeded: reuse that cache instead of starting (and leaking) a second one.
	v.mu.Lock()
	if v.cache != nil {
		res := initResult{cache: v.cache, jwksURL: v.jwksURL}
		v.mu.Unlock()
		return res, nil
	}
	v.mu.Unlock()

	ctx, cancel := context.WithTimeout(v.life, initTimeout)
	defer cancel()
	res, err := v.startCache(ctx)

	v.mu.Lock()
	defer v.mu.Unlock()
	switch {
	case err != nil:
		v.lastFailure = time.Now()
		return nil, err
	case v.closed:
		_ = res.cache.Shutdown(ctx)
		return nil, errors.New("verifier closed")
	}
	v.cache, v.jwksURL = res.cache, res.jwksURL
	return res, nil
}

func (v *OIDCVerifier) startCache(ctx context.Context) (initResult, error) {
	jwksURL := v.cfg.JWKSURL
	if jwksURL == "" {
		var err error
		if jwksURL, err = v.discoverJWKSURL(ctx); err != nil {
			return initResult{}, err
		}
	}
	cache, err := jwkfetch.NewCache(v.life, httprc.NewClient()) //nolint:contextcheck // the cache lives as long as the verifier, not this attempt
	if err != nil {
		return initResult{}, fmt.Errorf("new jwks cache: %w", err)
	}
	// ctx only bounds the wait for the first fetch here.
	if err := cache.Register(ctx, jwksURL, jwkfetch.WithMinInterval(5*time.Minute), jwkfetch.WithMaxInterval(time.Hour)); err != nil {
		_ = cache.Shutdown(ctx)
		return initResult{}, fmt.Errorf("register jwks %s: %w", jwksURL, err)
	}
	return initResult{cache: cache, jwksURL: jwksURL}, nil
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
// The refresh itself runs outside v.mu; ctx bounds only this caller's wait.
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
	cache, jwksURL := v.cache, v.jwksURL
	if cache == nil || time.Since(v.lastForcedRef) < forcedRefreshInterval {
		v.mu.Unlock()
		return false
	}
	v.lastForcedRef = time.Now()
	v.mu.Unlock()
	_, err = cache.Refresh(ctx, jwksURL)
	return err == nil
}
