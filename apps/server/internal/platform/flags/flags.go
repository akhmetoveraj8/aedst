// Package flags is the port to feature flags: OpenFeature (the vendor-neutral
// SDK) with flagd as the production provider.
//
// Flags gate rollout and operations (a new search path, a kill switch), never
// correctness: every evaluation takes a default and returns it on any error, an
// unreachable flagd included, so the service behaves as the code's default says
// when the flag system is down. Do not store authorisation, limits that protect
// data, or anything a request must not get wrong in a flag.
//
// Modules depend on Flags, not on the OpenFeature SDK. The SDK and the flagd
// provider are imported only in this package.
package flags

import (
	"context"
	"fmt"

	"github.com/open-feature/go-sdk/openfeature"
)

// Flags evaluates flags. targetingKey identifies the subject for percentage
// rollouts (a user id, never an email); "" evaluates without a subject.
type Flags interface {
	Bool(ctx context.Context, key string, def bool, targetingKey string) bool
	String(ctx context.Context, key string, def string, targetingKey string) string
}

// Client is the OpenFeature-backed Flags.
type Client struct {
	c *openfeature.Client
}

// New registers provider under domain and returns a Client bound to it. It
// waits for the provider to initialise; callers that must not block startup on
// an unreachable flagd pass a context-bounded provider (see NewFlagd).
func New(domain string, provider openfeature.FeatureProvider) (*Client, error) {
	if err := openfeature.SetNamedProviderAndWait(domain, provider); err != nil {
		return nil, fmt.Errorf("flags: init provider: %w", err)
	}
	return &Client{c: openfeature.NewClient(domain)}, nil
}

func (f *Client) Bool(ctx context.Context, key string, def bool, targetingKey string) bool {
	v, err := f.c.BooleanValue(ctx, key, def, evalContext(targetingKey))
	if err != nil {
		return def
	}
	return v
}

func (f *Client) String(ctx context.Context, key string, def string, targetingKey string) string {
	v, err := f.c.StringValue(ctx, key, def, evalContext(targetingKey))
	if err != nil {
		return def
	}
	return v
}

func evalContext(targetingKey string) openfeature.EvaluationContext {
	return openfeature.NewEvaluationContext(targetingKey, nil)
}

// Static is a Flags that always returns the default: used when no flag
// provider is configured.
type Static struct{}

func (Static) Bool(_ context.Context, _ string, def bool, _ string) bool       { return def }
func (Static) String(_ context.Context, _ string, def string, _ string) string { return def }
