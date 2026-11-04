package httpserver

import (
	"context"
	"crypto/tls"
	"errors"
	"fmt"
	"log/slog"
	"net/http"
	"time"
)

// ServerConfig bounds what one connection may cost (AEDST_HTTP_* in
// config.HTTPConfig). Zero values fall back to the defaults below.
type ServerConfig struct {
	Addr string
	// ReadHeaderTimeout stops slowloris-style clients that trickle headers.
	ReadHeaderTimeout time.Duration
	// ReadTimeout bounds reading a whole request (headers + body).
	ReadTimeout time.Duration
	// WriteTimeout bounds writing a response. Streaming RPCs clear it per
	// request (see Options.StreamingProcedures), so it may stay tight.
	WriteTimeout time.Duration
	// IdleTimeout closes idle keep-alive connections.
	IdleTimeout    time.Duration
	MaxHeaderBytes int
	// TLSCertFile/TLSKeyFile enable in-process TLS (HTTP/1.1 + HTTP/2 over
	// TLS, minimum TLS 1.2). Leave empty when TLS terminates at the edge
	// (load balancer / ingress / CDN) — then the server speaks h2c behind it.
	TLSCertFile string
	TLSKeyFile  string
}

const (
	defaultReadHeaderTimeout = 5 * time.Second
	defaultReadTimeout       = 30 * time.Second
	defaultWriteTimeout      = 60 * time.Second
	defaultIdleTimeout       = 120 * time.Second
	defaultMaxHeaderBytes    = 64 << 10
)

// Server wraps an http.Server. Without TLS it serves HTTP/1.1 and unencrypted
// HTTP/2 (h2c), so ConnectRPC can serve gRPC (which requires HTTP/2) behind a
// TLS-terminating edge; with TLS it serves HTTP/1.1 and HTTP/2 over TLS.
// Uses net/http's native Protocols field (Go 1.24+) rather than the
// deprecated golang.org/x/net/http2/h2c package.
type Server struct {
	httpServer *http.Server
	certFile   string
	keyFile    string
}

// New builds a Server with the default limits on addr.
func New(addr string, handler http.Handler, logger *slog.Logger) *Server {
	return NewWithConfig(ServerConfig{Addr: addr}, handler, logger)
}

// NewWithConfig builds a Server from cfg.
func NewWithConfig(cfg ServerConfig, handler http.Handler, logger *slog.Logger) *Server {
	protocols := new(http.Protocols)
	protocols.SetHTTP1(true)
	var tlsConfig *tls.Config
	if cfg.TLSCertFile != "" {
		protocols.SetHTTP2(true)
		tlsConfig = &tls.Config{MinVersion: tls.VersionTLS12}
	} else {
		protocols.SetUnencryptedHTTP2(true)
	}
	return &Server{
		certFile: cfg.TLSCertFile,
		keyFile:  cfg.TLSKeyFile,
		httpServer: &http.Server{
			Addr:              cfg.Addr,
			Handler:           handler,
			Protocols:         protocols,
			TLSConfig:         tlsConfig,
			ReadHeaderTimeout: orDefault(cfg.ReadHeaderTimeout, defaultReadHeaderTimeout),
			ReadTimeout:       orDefault(cfg.ReadTimeout, defaultReadTimeout),
			WriteTimeout:      orDefault(cfg.WriteTimeout, defaultWriteTimeout),
			IdleTimeout:       orDefault(cfg.IdleTimeout, defaultIdleTimeout),
			MaxHeaderBytes:    orDefault(cfg.MaxHeaderBytes, defaultMaxHeaderBytes),
			ErrorLog:          slog.NewLogLogger(logger.Handler(), slog.LevelWarn),
		},
	}
}

func orDefault[T comparable](v, def T) T {
	var zero T
	if v == zero {
		return def
	}
	return v
}

// HTTPServer exposes the underlying server (tests and diagnostics).
func (s *Server) HTTPServer() *http.Server { return s.httpServer }

// ListenAndServe blocks until the server stops; a clean Shutdown returns nil.
func (s *Server) ListenAndServe() error {
	var err error
	if s.certFile != "" {
		err = s.httpServer.ListenAndServeTLS(s.certFile, s.keyFile)
	} else {
		err = s.httpServer.ListenAndServe()
	}
	if err != nil && !errors.Is(err, http.ErrServerClosed) {
		return fmt.Errorf("httpserver: listen %s: %w", s.httpServer.Addr, err)
	}
	return nil
}

func (s *Server) Shutdown(ctx context.Context) error {
	return s.httpServer.Shutdown(ctx)
}
