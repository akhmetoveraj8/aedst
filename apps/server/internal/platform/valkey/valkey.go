// Package valkey wires the shared Valkey client. Valkey is not the primary
// database: it backs cache and rate limiting only (see
// docs/content/server/architecture.md). It is deliberately NOT used for locks
// (use internal/platform/lock, PostgreSQL advisory locks) or for messaging
// (use River InsertTx events, see internal/platform/events).
//
// The client is github.com/redis/go-redis/v9: Valkey speaks the same RESP
// protocol, so no separate client library is needed. Keep every go-redis
// import inside this package.
//
// Valkey is an optional dependency by design: nothing correct depends on it,
// so the client neither fails process startup nor takes a replica out of
// rotation when it is unreachable (see cmd/server and httpserver.Check's
// Optional flag). It reconnects on its own once Valkey is back.
package valkey

import (
	"context"
	"crypto/tls"
	"crypto/x509"
	"fmt"
	"net"
	"os"
	"time"

	"github.com/redis/go-redis/v9"
)

type Config struct {
	Addr     string
	Password string
	DB       int
	// TLS, when non-nil, makes the client connect over TLS.
	TLS *tls.Config
}

// NewClient builds the client. It does not connect: connections are dialed
// lazily and re-dialed after failures.
func NewClient(cfg Config) *redis.Client {
	return redis.NewClient(&redis.Options{
		Addr:         cfg.Addr,
		Password:     cfg.Password,
		DB:           cfg.DB,
		DialTimeout:  time.Second,
		ReadTimeout:  500 * time.Millisecond,
		WriteTimeout: 500 * time.Millisecond,
		MaxRetries:   1,
		TLSConfig:    cfg.TLS,
	})
}

// Ping reports whether Valkey answers, for readiness reporting and a startup
// log line.
func Ping(ctx context.Context, client *redis.Client) error {
	if err := client.Ping(ctx).Err(); err != nil {
		return fmt.Errorf("valkey: ping: %w", err)
	}
	return nil
}

// TLSConfig builds the client TLS settings: TLS 1.2+, the server certificate
// verified against caFile (PEM; empty = the system roots) and against serverName
// (empty = the host of addr).
func TLSConfig(addr, serverName, caFile string) (*tls.Config, error) {
	cfg := &tls.Config{MinVersion: tls.VersionTLS12, ServerName: serverName}
	if cfg.ServerName == "" {
		host, _, err := net.SplitHostPort(addr)
		if err != nil {
			host = addr
		}
		cfg.ServerName = host
	}
	if caFile != "" {
		pem, err := os.ReadFile(caFile) //nolint:gosec // operator-supplied path (AEDST_VALKEY_TLS_CA_FILE), not request input
		if err != nil {
			return nil, fmt.Errorf("valkey: read CA file: %w", err)
		}
		pool := x509.NewCertPool()
		if !pool.AppendCertsFromPEM(pem) {
			return nil, fmt.Errorf("valkey: CA file %s holds no PEM certificate", caFile)
		}
		cfg.RootCAs = pool
	}
	return cfg, nil
}
