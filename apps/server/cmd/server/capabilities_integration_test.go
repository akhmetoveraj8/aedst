//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"io"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/platform/postgrestest"
)

func (s *server) capabilities(t *testing.T, clientHeader string) (int, map[string]any) {
	t.Helper()
	req, _ := http.NewRequest(http.MethodPost, s.base+"/aedst.capabilities.v1.CapabilitiesService/GetCapabilities", bytes.NewReader([]byte(`{}`)))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")
	if clientHeader != "" {
		req.Header.Set("X-Aedst-Client", clientHeader)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatal(err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

// Capability negotiation through the real binary wiring: public (no token),
// driven by the environment, and behind the same version gate as every RPC.
func TestServer_CapabilitiesAreNegotiatedBeforeSignIn(t *testing.T) {
	s := start(t, map[string]string{
		"AEDST_MIN_CLIENT_VERSIONS":         "android=1.2.0",
		"AEDST_RECOMMENDED_CLIENT_VERSIONS": "android=1.4.0",
		"AEDST_FEATURES":                    `{"new_search":{"enabled":true,"params":{"rollout_percent":"25"}}}`,
	})
	s.waitReady(t)

	status, body := s.capabilities(t, "android/1.3.0")
	if status != http.StatusOK {
		t.Fatalf("GetCapabilities without a token = %d %v, want 200 (public)", status, body)
	}
	if body["updateStatus"] != "UPDATE_STATUS_RECOMMENDED" {
		t.Errorf("updateStatus = %v, want RECOMMENDED for android/1.3.0", body["updateStatus"])
	}
	clients, _ := body["clients"].(map[string]any)
	if android, _ := clients["android"].(map[string]any); android["minimum"] != "1.2.0" || android["recommended"] != "1.4.0" {
		t.Errorf("clients = %v", clients)
	}
	features, _ := body["features"].(map[string]any)
	if f, _ := features["new_search"].(map[string]any); f["enabled"] != true {
		t.Errorf("features = %v, want the operator flag", features)
	}
	if f, _ := features["auth.oidc"].(map[string]any); f["enabled"] != true {
		t.Errorf("features = %v, want the derived auth.first_party capability on", features)
	}
	if body["serverVersion"] == "" || body["serverVersion"] == nil {
		t.Error("serverVersion missing")
	}

	if status, body = s.capabilities(t, ""); status != http.StatusOK || body["updateStatus"] != nil && body["updateStatus"] != "UPDATE_STATUS_UNSPECIFIED" {
		t.Errorf("anonymous client = %d %v", status, body)
	}
	if status, body = s.capabilities(t, "android/1.0.0"); body["code"] != "failed_precondition" {
		t.Errorf("unsupported client = %d %v, want failed_precondition (CLIENT_UPGRADE_REQUIRED)", status, body)
	}
	if !strings.Contains(string(mustJSON(t, body)), "CLIENT_UPGRADE_REQUIRED") {
		t.Errorf("error details lack CLIENT_UPGRADE_REQUIRED: %v", body)
	}
}

func mustJSON(t *testing.T, v any) []byte {
	t.Helper()
	b, err := json.Marshal(v)
	if err != nil {
		t.Fatal(err)
	}
	return b
}

// AEDST_DATABASE_READ_URL opens a separate read pool, lag-tolerant reads
// (search) go through it, and it is visible to Postgres as its own application.
func TestServer_ReadReplicaPool(t *testing.T) {
	s := start(t, map[string]string{
		// A different string for the same database: stands in for a replica.
		"AEDST_DATABASE_READ_URL": "{dsn}&application_name=replica-stand-in",
	})
	s.waitReady(t)
	token := s.register(t, "reader@example.com")

	if status, body := s.rpc(t, "/aedst.search.v1.SearchService/Search", token, "", map[string]any{"query": "anything"}); status != http.StatusOK {
		t.Fatalf("Search through the read pool = %d %v", status, body)
	}

	pool := postgrestest.Connect(t, s.dsn)
	var readConns int
	deadline := time.Now().Add(10 * time.Second)
	for readConns == 0 && time.Now().Before(deadline) {
		if err := pool.QueryRow(context.Background(), "SELECT count(*) FROM pg_stat_activity WHERE application_name = 'aedst-server-read'").Scan(&readConns); err != nil {
			t.Fatal(err)
		}
		time.Sleep(50 * time.Millisecond)
	}
	if readConns == 0 {
		t.Error("no connection from the read pool (application_name aedst-server-read) is open")
	}
}
