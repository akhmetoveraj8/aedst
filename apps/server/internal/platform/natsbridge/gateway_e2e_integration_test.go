//go:build integration

package natsbridge_test

import (
	"context"
	"crypto/ed25519"
	"crypto/rand"
	"encoding/base64"
	"encoding/json"
	"fmt"
	"net"
	"net/http"
	"net/http/httptest"
	"os"
	"os/exec"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"golang.org/x/net/websocket"

	"github.com/aedst/server/internal/platform/database"
	"github.com/aedst/server/internal/platform/events/eventstest"
	"github.com/aedst/server/internal/platform/natsbridge"
	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/shared/ids"
)

// TestEventReachesAWebSocketClientThroughTheGateway is the end-to-end path of ADR-0021:
//
//	producer transaction -> River job -> natsbridge -> NATS JetStream -> Rust gateway -> WebSocket client
//
// It needs Docker (Postgres, as every integration test) and the built gateway binary:
//
//	cargo build --manifest-path apps/gateway/Cargo.toml
//	AEDST_GATEWAY_BIN=apps/gateway/target/debug/aedst-gateway go test -tags integration ./internal/platform/natsbridge/
func TestEventReachesAWebSocketClientThroughTheGateway(t *testing.T) {
	bin := os.Getenv("AEDST_GATEWAY_BIN")
	if bin == "" {
		t.Skip("AEDST_GATEWAY_BIN is not set: build apps/gateway and point it at the binary")
	}
	ctx := context.Background()
	natsURL := startServer(t)

	// The fake identity provider: discovery + JWKS, an Ed25519 key made for this test.
	pub, priv, err := ed25519.GenerateKey(rand.Reader)
	if err != nil {
		t.Fatal(err)
	}
	var idp *httptest.Server
	idp = httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		switch r.URL.Path {
		case "/.well-known/openid-configuration":
			_ = json.NewEncoder(w).Encode(map[string]string{"issuer": idp.URL, "jwks_uri": idp.URL + "/jwks"})
		case "/jwks":
			_ = json.NewEncoder(w).Encode(map[string]any{"keys": []map[string]string{{
				"kty": "OKP", "crv": "Ed25519", "alg": "EdDSA", "use": "sig", "kid": "k1",
				"x": base64.RawURLEncoding.EncodeToString(pub),
			}}})
		default:
			http.NotFound(w, r)
		}
	}))
	defer idp.Close()

	user := ids.New()
	token := signToken(t, priv, idp.URL, "aedst-api", user.String())

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

	// Rust side: the gateway process.
	addr := freeAddr(t)
	cmd := exec.Command(bin)
	cmd.Env = append(os.Environ(),
		"AEDST_ENV=development", "AEDST_OIDC_ISSUER="+idp.URL, "AEDST_OIDC_AUDIENCE=aedst-api",
		"AEDST_NATS_URL="+natsURL, "AEDST_GATEWAY_ADDR="+addr,
		// The Go client sends an Origin; the gateway refuses browser origins that are not listed (fail closed).
		"AEDST_GATEWAY_ALLOWED_ORIGINS=http://localhost")
	cmd.Stdout, cmd.Stderr = os.Stdout, os.Stderr
	if err := cmd.Start(); err != nil {
		t.Fatalf("start gateway: %v", err)
	}
	t.Cleanup(func() { _ = cmd.Process.Kill(); _ = cmd.Wait() })
	waitReady(t, "http://"+addr+"/readyz")

	// Unauthenticated clients are refused.
	if _, err := websocket.Dial("ws://"+addr+"/v1/ws", "", "http://localhost"); err == nil {
		t.Fatal("a socket without a token was accepted")
	}

	cfg, err := websocket.NewConfig("ws://"+addr+"/v1/ws", "http://localhost")
	if err != nil {
		t.Fatal(err)
	}
	cfg.Header.Set("Authorization", "Bearer "+token)
	conn, err := websocket.DialConfig(cfg)
	if err != nil {
		t.Fatalf("dial gateway: %v", err)
	}
	defer conn.Close()

	// Publish inside a producer transaction, exactly like a module's repository does.
	var eventID ids.ID
	if err := database.WithTx(ctx, pool, func(ctx context.Context, tx pgx.Tx) error {
		var err error
		eventID, err = rt.Publisher.Publish(ctx, tx, eventType, 1, ids.New(),
			map[string]any{"task_id": ids.New().String(), "user_id": user.String(), "title": "Write the report"})
		return err
	}); err != nil {
		t.Fatal(err)
	}

	_ = conn.SetReadDeadline(time.Now().Add(30 * time.Second))
	var frame string
	if err := websocket.Message.Receive(conn, &frame); err != nil {
		t.Fatalf("no frame reached the client: %v", err)
	}
	var env natsbridge.Envelope
	if err := json.Unmarshal([]byte(frame), &env); err != nil {
		t.Fatalf("frame is not an envelope: %v\n%s", err, frame)
	}
	if env.ID != eventID.String() || env.Type != eventType || env.Version != 1 {
		t.Fatalf("envelope = %+v, want event %s %s v1", env, eventID, eventType)
	}
	var payload map[string]any
	if err := json.Unmarshal(env.Payload, &payload); err != nil || payload["title"] != "Write the report" {
		t.Fatalf("payload = %s (%v), want the producer's JSON untouched", env.Payload, err)
	}
}

func signToken(t *testing.T, key ed25519.PrivateKey, issuer, audience, sub string) string {
	t.Helper()
	enc := base64.RawURLEncoding.EncodeToString
	header, _ := json.Marshal(map[string]string{"alg": "EdDSA", "typ": "at+jwt", "kid": "k1"})
	claims, _ := json.Marshal(map[string]any{"iss": issuer, "aud": audience, "sub": sub, "exp": time.Now().Add(10 * time.Minute).Unix()})
	signing := enc(header) + "." + enc(claims)
	return signing + "." + enc(ed25519.Sign(key, []byte(signing)))
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
	t.Fatal(fmt.Sprintf("%s never became ready", url))
}
