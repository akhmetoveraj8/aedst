//go:build integration

package natsbridge_test

import (
	"context"
	"encoding/json"
	"io"
	"log/slog"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"testing"
	"time"

	connect "connectrpc.com/connect/v2"
	"github.com/jackc/pgx/v5"
	"golang.org/x/net/websocket"

	realtimev1connect "github.com/aedst/server/gen/go/aedst/realtime/v1/realtimev1connect"
	platformauth "github.com/aedst/server/internal/platform/auth"
	"github.com/aedst/server/internal/platform/auth/authtest"
	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/events/eventstest"
	"github.com/aedst/server/internal/platform/httpserver"
	"github.com/aedst/server/internal/platform/modulekit"
	"github.com/aedst/server/internal/platform/natsbridge"
	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/platform/realtime"
	"github.com/aedst/server/internal/shared/ids"
)

// TestEventReachesAWebSocketClientThroughTheGateway is the end-to-end path of ADR-0021 and ADR-0026:
//
//	producer transaction -> River job -> natsbridge (Protobuf envelope) -> NATS JetStream
//	  -> Rust gateway -> WebSocket client
//
// The gateway verifies no token itself: it asks the Go RealtimeService, which sits behind the real
// OIDC interceptor here, exactly as in production. It needs Docker (Postgres, as every integration
// test) and the built gateway binary:
//
//	cargo build --manifest-path apps/gateway/Cargo.toml
//	AEDST_GATEWAY_BIN=apps/gateway/target/debug/aedst-gateway go test -tags integration ./internal/platform/natsbridge/
func TestEventReachesAWebSocketClientThroughTheGateway(t *testing.T) {
	bin := gatewayBin(t)
	ctx := context.Background()
	natsURL := startServer(t)

	// Go side: a real River runtime with the bridge subscribed.
	pool := postgrestest.NewPool(t)
	rt := eventstest.Start(t, pool)
	bridge, err := natsbridge.Connect(natsbridge.Config{URL: natsURL})
	if err != nil {
		t.Fatal(err)
	}
	defer bridge.Close()
	const eventType = "tasks.v1.TaskCompleted"
	bridge.Subscribe(rt.Registry, []string{eventType})
	if err := bridge.EnsureStream(ctx); err != nil {
		t.Fatal(err)
	}
	gw := startGateway(t, bin, natsURL)
	conn := gw.connect(t)
	defer conn.Close()

	// Publish inside a producer transaction, exactly like a module's repository does.
	var eventID ids.ID
	if err := database.WithTx(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		eventID, err = rt.Publisher.Publish(ctx, tx, eventType, 1, ids.New(),
			map[string]any{"task_id": ids.New().String(), "user_id": gw.user.String(), "title": "Write the report"})
		return err
	}); err != nil {
		t.Fatal(err)
	}
	checkFrame(t, receiveFrame(t, conn), eventID, eventType)
}

// TestGatewayDeliversAForwardedEvent is the same path without the database: the
// event is handed to the bridge directly, as River would. It needs only the
// gateway binary (no Docker), so it is the quick local check of the Go/Rust
// contract (RealtimeService call, Protobuf envelope, client frame).
func TestGatewayDeliversAForwardedEvent(t *testing.T) {
	bin := gatewayBin(t)
	natsURL := startServer(t)
	bridge, err := natsbridge.Connect(natsbridge.Config{URL: natsURL})
	if err != nil {
		t.Fatal(err)
	}
	defer bridge.Close()
	if err := bridge.EnsureStream(context.Background()); err != nil {
		t.Fatal(err)
	}
	gw := startGateway(t, bin, natsURL)
	conn := gw.connect(t)
	defer conn.Close()

	payload, _ := json.Marshal(map[string]any{"task_id": ids.New().String(), "user_id": gw.user.String(), "title": "Write the report"})
	e := events.Event{
		ID: ids.New(), Type: "tasks.v1.TaskCompleted", Version: 1,
		OccurredAt: time.Now().UTC(), PartitionKey: ids.New(), Payload: payload,
	}
	if err := bridge.Forward(context.Background(), e); err != nil {
		t.Fatal(err)
	}
	checkFrame(t, receiveFrame(t, conn), e.ID, e.Type)
}

func gatewayBin(t *testing.T) string {
	t.Helper()
	bin := os.Getenv("AEDST_GATEWAY_BIN")
	if bin == "" {
		t.Skip("AEDST_GATEWAY_BIN is not set: build apps/gateway and point it at the binary")
	}
	return bin
}

// gateway is a running Rust gateway in front of a Go RealtimeService that sits
// behind the production OIDC interceptor and a test identity provider.
type gateway struct {
	addr  string
	token string
	user  ids.ID
}

func startGateway(t *testing.T, bin, natsURL string) gateway {
	t.Helper()
	idp := authtest.New(t)
	verifier, err := platformauth.NewOIDCVerifier(platformauth.OIDCConfig{
		Issuer: idp.URL, Audience: authtest.Audience, Algorithms: []string{"ES256"},
	})
	if err != nil {
		t.Fatal(err)
	}
	logger := slog.New(slog.NewTextHandler(io.Discard, nil))
	router := http.NewServeMux()
	mounter := modulekit.NewMounter(router, []connect.ServerInterceptor{httpserver.AuthInterceptor(verifier, nil, logger)}, nil, 1<<20, true)
	modulekit.Mount(mounter, realtimev1connect.RegisterRealtimeServiceHandler,
		realtimev1connect.RealtimeServiceHandler(realtime.Handler{}), realtime.MaxRequestBytes)
	api := httptest.NewServer(router)
	t.Cleanup(api.Close)

	addr := freeAddr(t)
	cmd := exec.Command(bin)
	cmd.Env = append(os.Environ(),
		"AEDST_ENV=development", "AEDST_GATEWAY_API_URL="+api.URL,
		"AEDST_NATS_URL="+natsURL, "AEDST_GATEWAY_ADDR="+addr,
		// The Go client sends an Origin; the gateway refuses browser origins that are not listed (fail closed).
		"AEDST_GATEWAY_ALLOWED_ORIGINS=http://localhost")
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("start gateway: %v", err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	waitReady(t, "http://"+addr+"/readyz")

	user := ids.New()
	return gateway{addr: addr, token: idp.Token(t, user.String()), user: user} // a UUID subject is the owner id as is
}

// connect checks that the gateway refuses a missing or forged token, then opens
// a socket with the real one.
func (g gateway) connect(t *testing.T) *websocket.Conn {
	t.Helper()
	if _, err := websocket.Dial("ws://"+g.addr+"/v1/ws", "", "http://localhost"); err == nil {
		t.Fatal("a socket without a token was accepted")
	}
	if _, err := dial(g.addr, g.token+"x"); err == nil {
		t.Fatal("a socket with a forged token was accepted")
	}
	conn, err := dial(g.addr, g.token)
	if err != nil {
		t.Fatalf("dial gateway: %v", err)
	}
	return conn
}

func receiveFrame(t *testing.T, conn *websocket.Conn) goldenFrame {
	t.Helper()
	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	var raw string
	if err := websocket.Message.Receive(conn, &raw); err != nil {
		t.Fatalf("no frame reached the client: %v", err)
	}
	var frame goldenFrame
	if err := json.Unmarshal([]byte(raw), &frame); err != nil {
		t.Fatalf("frame is not the client JSON: %v\n%s", err, raw)
	}
	return frame
}

func checkFrame(t *testing.T, frame goldenFrame, eventID ids.ID, eventType string) {
	t.Helper()
	if frame.ID != eventID.String() || frame.Type != eventType || frame.Version != 1 {
		t.Fatalf("frame = %+v, want event %s %s v1", frame, eventID, eventType)
	}
	var payload map[string]any
	if err := json.Unmarshal(frame.Payload, &payload); err != nil || payload["title"] != "Write the report" {
		t.Fatalf("payload = %s (%v), want the producer's JSON untouched", frame.Payload, err)
	}
}

func dial(addr, token string) (*websocket.Conn, error) {
	cfg, err := websocket.NewConfig("ws://"+addr+"/v1/ws", "http://localhost")
	if err != nil {
		return nil, err
	}
	cfg.Header.Set("Authorization", "Bearer "+token)
	return websocket.DialConfig(cfg)
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatal(err)
	}
	defer l.Close()
	return l.Addr().String()
}

func waitReady(t *testing.T, url string) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		if resp, err := http.Get(url); err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(200 * time.Millisecond)
	}
	t.Fatal(url + " never became ready")
}
