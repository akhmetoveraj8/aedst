package idempotency

import "context"

type contextKey struct{}

// WithKey stores the request's idempotency key on ctx.
func WithKey(ctx context.Context, key string) context.Context {
	return context.WithValue(ctx, contextKey{}, key)
}

// KeyFromContext returns the idempotency key set by HeaderInterceptor, if
// any. Transport handlers read it here and pass it down to their service as
// an explicit argument — application/service code never reads context
// directly, to stay testable without a connect.Request (see docs/content/server/modules.md).
func KeyFromContext(ctx context.Context) (string, bool) {
	key, ok := ctx.Value(contextKey{}).(string)
	return key, ok && key != ""
}
