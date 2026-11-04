// Package clientip derives the caller's network address in a way that cannot be
// spoofed by request headers, and carries it in the request context.
//
// It wraps github.com/realclientip/realclientip-go: with no trusted proxy the
// socket peer address is used (RemoteAddrStrategy); with N trusted reverse
// proxies the address is the Nth from the right of X-Forwarded-For
// (RightmostTrustedCountStrategy), i.e. only entries appended by our own
// proxies are believed. X-Real-IP, True-Client-IP and the leftmost
// X-Forwarded-For entry are never trusted.
package clientip

import (
	"context"
	"net/http"

	"github.com/realclientip/realclientip-go"
)

type ctxKey struct{}

// Middleware stores the derived client IP in the request context. trustedHops
// is the exact number of trusted reverse proxies in front of the server;
// 0 (or negative) uses the socket peer address.
func Middleware(trustedHops int) func(http.Handler) http.Handler {
	var strategy realclientip.Strategy = realclientip.RemoteAddrStrategy{}
	if trustedHops > 0 {
		// Cannot fail: the header name is valid and the count is positive.
		strategy = realclientip.Must(realclientip.NewRightmostTrustedCountStrategy("X-Forwarded-For", trustedHops))
	}
	return func(next http.Handler) http.Handler {
		return http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
			ip := strategy.ClientIP(r.Header, r.RemoteAddr)
			next.ServeHTTP(w, r.WithContext(WithIP(r.Context(), ip)))
		})
	}
}

// WithIP returns ctx carrying ip as the client address.
func WithIP(ctx context.Context, ip string) context.Context {
	return context.WithValue(ctx, ctxKey{}, ip)
}

// FromContext returns the client IP stored by Middleware, or "" when none is
// known (or it could not be derived).
func FromContext(ctx context.Context) string {
	ip, _ := ctx.Value(ctxKey{}).(string)
	return ip
}
