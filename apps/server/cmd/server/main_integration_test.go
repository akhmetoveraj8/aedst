//go:build integration

package main

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"io"
	"net"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/platform/postgrestest"
)

// These tests boot the real server — the same run() the binary uses, with real
// wiring, real migrations on a real Postgres, and no Dragonfly — and drive it over
// HTTP. They cover what unit tests cannot: that the wiring, interceptor order,
// readiness, retention and shutdown behave as documented.

type server struct {
	dsn  string
	base string
	done chan error
	stop context.CancelFunc
}

func freeAddr(t *testing.T) string {
	t.Helper()
	l, err := net.Listen("tcp", "127.0.0.1:0")
	if err != nil {
		t.Fatalf("free port: %v", err)
	}
	defer func() { _ = l.Close() }()
	return l.Addr().String()
}

// start runs the server against a fresh migrated database with extra environment.
func start(t *testing.T, env map[string]string) *server {
	t.Helper()
	dsn := postgrestest.NewDatabase(t)
	postgrestest.Migrate(t, dsn, "tasks", "notifications", "search", "media", "admin", "integrity", "appattest")
	return startOn(t, dsn, env)
}

// startOn runs one more server process against an already migrated database: the
// way to model N replicas (or an API and a worker) on one Postgres.
func startOn(t *testing.T, dsn string, env map[string]string) *server {
	t.Helper()
	addr := freeAddr(t)
	for k, v := range map[string]string{
		"AEDST_ENV":                        "test",
		"AEDST_DATABASE_URL":               dsn,
		"AEDST_HTTP_ADDR":                  addr,
		"AEDST_OIDC_ISSUER":                idp(t).URL,
		"AEDST_OIDC_AUDIENCE":              testAudience,
		"AEDST_CACHE_ADDR":                 "127.0.0.1:1", // nothing listens: Dragonfly is optional
		"AEDST_LOG_LEVEL":                  "error",
		"AEDST_RETENTION_INTERVAL_MINUTES": "1",
		"AEDST_GRPC_REFLECTION_ENABLED":    "false",
		"AEDST_SHUTDOWN_TIMEOUT_SECONDS":   "10",
		"AEDST_AUTH_RATE_LIMIT_PER_MINUTE": "0",
		"AEDST_API_RATE_LIMIT_PER_MINUTE":  "0",
	} {
		t.Setenv(k, v)
	}
	for k, v := range env {
		t.Setenv(k, strings.ReplaceAll(v, "{dsn}", dsn)) // {dsn} lets a test derive a variant of its own database URL
	}

	ctx, cancel := context.WithCancel(context.Background())
	s := &server{dsn: dsn, base: "http://" + addr, done: make(chan error, 1), stop: cancel}
	go func() { s.done <- run(ctx) }()
	t.Cleanup(func() {
		cancel()
		select {
		case <-s.done:
		case <-time.After(20 * time.Second):
			t.Error("server did not stop within 20s of cancellation")
		}
	})
	return s
}

func (s *server) waitReady(t *testing.T) {
	t.Helper()
	deadline := time.Now().Add(30 * time.Second)
	for time.Now().Before(deadline) {
		select {
		case err := <-s.done:
			t.Fatalf("server exited during startup: %v", err)
		default:
		}
		if resp, err := http.Get(s.base + "/readyz"); err == nil {
			_ = resp.Body.Close()
			if resp.StatusCode == http.StatusOK {
				return
			}
		}
		time.Sleep(100 * time.Millisecond)
	}
	t.Fatal("server never became ready")
}

func (s *server) rpc(t *testing.T, path, token, idempotencyKey string, body any) (int, map[string]any) {
	t.Helper()
	payload, _ := json.Marshal(body)
	req, _ := http.NewRequest(http.MethodPost, s.base+path, bytes.NewReader(payload))
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("Connect-Protocol-Version", "1")
	if token != "" {
		req.Header.Set("Authorization", "Bearer "+token)
	}
	if idempotencyKey != "" {
		req.Header.Set("Idempotency-Key", idempotencyKey)
	}
	resp, err := http.DefaultClient.Do(req)
	if err != nil {
		t.Fatalf("POST %s: %v", path, err)
	}
	defer func() { _ = resp.Body.Close() }()
	raw, _ := io.ReadAll(resp.Body)
	var out map[string]any
	_ = json.Unmarshal(raw, &out)
	return resp.StatusCode, out
}

// register returns an access token of a plain signed-in user ("user" role) whose
// identity is derived from email, standing in for a sign-in at the OIDC provider.
func (s *server) register(t *testing.T, email string) string {
	t.Helper()
	return idp(t).Token(t, email, "user")
}

func TestServer_EndToEnd(t *testing.T) {
	s := start(t, map[string]string{
		// Deleting needs a role the default "user" session does not hold.
		"AEDST_ROLE_POLICY": "/aedst.tasks.v1.TasksService/DeleteTask=admin|support",
	})
	s.waitReady(t)

	t.Run("readiness degrades, not fails, without Dragonfly", func(t *testing.T) {
		resp, err := http.Get(s.base + "/readyz")
		if err != nil {
			t.Fatal(err)
		}
		defer func() { _ = resp.Body.Close() }()
		body, _ := io.ReadAll(resp.Body)
		if resp.StatusCode != http.StatusOK || !strings.Contains(string(body), "degraded") {
			t.Fatalf("/readyz = %d %s, want 200 degraded", resp.StatusCode, body)
		}
		if resp.Header.Get("X-Content-Type-Options") != "nosniff" {
			t.Error("security headers missing")
		}
	})

	t.Run("gRPC health is served and reflection is off by default", func(t *testing.T) {
		status, body := s.rpc(t, "/grpc.health.v1.Health/Check", "", "", map[string]any{})
		if status != http.StatusOK || body["status"] != "SERVING_STATUS_SERVING" {
			t.Fatalf("health = %d %v", status, body)
		}
		resp, err := http.Post(s.base+"/grpc.reflection.v1.ServerReflection/ServerReflectionInfo", "application/json", strings.NewReader("{}"))
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode != http.StatusNotFound {
			t.Errorf("reflection = %d, want 404 when disabled", resp.StatusCode)
		}
	})

	token := s.register(t, "e2e@example.com")

	t.Run("unauthenticated calls are rejected before the handler", func(t *testing.T) {
		if status, _ := s.rpc(t, "/aedst.tasks.v1.TasksService/ListTasks", "", "", map[string]any{}); status != http.StatusUnauthorized {
			t.Fatalf("ListTasks without a token = %d, want 401", status)
		}
	})

	var taskID string
	t.Run("a retried create with the same Idempotency-Key is one task", func(t *testing.T) {
		create := map[string]any{"title": "Ship it", "priority": "TASK_PRIORITY_HIGH", "dueDate": time.Now().Add(72 * time.Hour).UTC().Format(time.RFC3339)}
		status, first := s.rpc(t, "/aedst.tasks.v1.TasksService/CreateTask", token, "key-1", create)
		if status != http.StatusOK {
			t.Fatalf("CreateTask = %d %v", status, first)
		}
		_, second := s.rpc(t, "/aedst.tasks.v1.TasksService/CreateTask", token, "key-1", create)
		taskID = first["task"].(map[string]any)["id"].(string)
		if second["task"].(map[string]any)["id"] != taskID {
			t.Fatalf("retry created another task: %v vs %v", first, second)
		}
		if status, body := s.rpc(t, "/aedst.tasks.v1.TasksService/CreateTask", token, "bad key", create); status != http.StatusBadRequest {
			t.Fatalf("malformed Idempotency-Key = %d %v, want 400", status, body)
		}
	})

	t.Run("validation and optimistic concurrency reach the client as the right codes", func(t *testing.T) {
		if status, body := s.rpc(t, "/aedst.tasks.v1.TasksService/UpdateTask", token, "", map[string]any{"id": taskID, "title": "  ", "updateMask": "title"}); status != http.StatusBadRequest {
			t.Errorf("blank title = %d %v, want 400", status, body)
		}
		if status, body := s.rpc(t, "/aedst.tasks.v1.TasksService/UpdateTask", token, "", map[string]any{"id": taskID, "title": "x", "updateMask": "title", "expectedVersion": 99}); status != http.StatusConflict {
			t.Errorf("stale version = %d %v, want 409", status, body)
		}
	})

	t.Run("completing repeatedly is one transition and one notification", func(t *testing.T) {
		for range 3 {
			if status, body := s.rpc(t, "/aedst.tasks.v1.TasksService/CompleteTask", token, "", map[string]any{"id": taskID}); status != http.StatusOK {
				t.Fatalf("CompleteTask = %d %v", status, body)
			}
		}
		pool := postgrestest.Connect(t, s.dsn)
		count := func(query string) (n int) {
			t.Helper()
			if err := pool.QueryRow(context.Background(), query).Scan(&n); err != nil {
				t.Fatalf("%s: %v", query, err)
			}
			return n
		}
		if n := count("SELECT count(*) FROM river_job WHERE kind = 'platform.event_delivery' AND args->>'consumer' = 'notifications.task_completed'"); n != 1 {
			t.Fatalf("notification delivery jobs = %d after three completes, want 1", n)
		}
		// River delivers asynchronously: wait for the projection.
		deadline := time.Now().Add(10 * time.Second)
		for count("SELECT count(*) FROM notifications.notifications") == 0 && time.Now().Before(deadline) {
			time.Sleep(50 * time.Millisecond)
		}
		time.Sleep(300 * time.Millisecond) // a duplicate, if any, would have arrived by now
		if n := count("SELECT count(*) FROM notifications.notifications"); n != 1 {
			t.Fatalf("notifications = %d, want exactly 1", n)
		}
	})

	t.Run("the role policy protects DeleteTask and only that", func(t *testing.T) {
		status, body := s.rpc(t, "/aedst.tasks.v1.TasksService/DeleteTask", token, "", map[string]any{"id": taskID})
		if status != http.StatusForbidden {
			t.Fatalf("DeleteTask as a plain user = %d %v, want 403", status, body)
		}
		if status, _ := s.rpc(t, "/aedst.tasks.v1.TasksService/GetTask", token, "", map[string]any{"id": taskID}); status != http.StatusOK {
			t.Fatalf("GetTask = %d, want it unaffected by the policy", status)
		}
	})

	t.Run("AdminService is closed to non-admins by default", func(t *testing.T) {
		if status, body := s.rpc(t, "/aedst.admin.v1.AdminService/GetOverview", token, "", map[string]any{}); status != http.StatusForbidden {
			t.Fatalf("GetOverview as a plain user = %d %v, want 403 from the built-in policy", status, body)
		}
	})

	t.Run("new services are mounted, authenticated and validated", func(t *testing.T) {
		if status, _ := s.rpc(t, "/aedst.search.v1.SearchService/Search", "", "", map[string]any{"query": "x"}); status != http.StatusUnauthorized {
			t.Errorf("Search without a token = %d, want 401", status)
		}
		if status, _ := s.rpc(t, "/aedst.search.v1.SearchService/Search", token, "", map[string]any{"query": ""}); status != http.StatusBadRequest {
			t.Errorf("Search with an empty query = %d, want 400 from protovalidate", status)
		}
		integrityReq := map[string]any{"integrityToken": "t", "action": "login", "requestHash": strings.Repeat("A", 43)}
		if status, _ := s.rpc(t, "/aedst.integrity.v1.IntegrityService/VerifyIntegrityToken", "", "", integrityReq); status != http.StatusUnauthorized {
			t.Errorf("VerifyIntegrityToken without a token = %d, want 401", status)
		}
		if status, body := s.rpc(t, "/aedst.integrity.v1.IntegrityService/VerifyIntegrityToken", token, "", integrityReq); body["code"] != "failed_precondition" {
			t.Errorf("VerifyIntegrityToken while disabled = %d %v, want FAILED_PRECONDITION", status, body)
		}
		if status, _ := s.rpc(t, "/aedst.integrity.v1.IntegrityService/VerifyIntegrityToken", token, "", map[string]any{"integrityToken": "t", "action": "Bad Action", "requestHash": "x"}); status != http.StatusBadRequest {
			t.Errorf("VerifyIntegrityToken with an invalid action = %d, want 400 from protovalidate", status)
		}
		if status, _ := s.rpc(t, "/aedst.appattest.v1.AppAttestService/CreateChallenge", "", "", map[string]any{}); status != http.StatusUnauthorized {
			t.Errorf("CreateChallenge without a token = %d, want 401", status)
		}
		if status, body := s.rpc(t, "/aedst.appattest.v1.AppAttestService/CreateChallenge", token, "", map[string]any{}); body["code"] != "failed_precondition" {
			t.Errorf("CreateChallenge while disabled = %d %v, want FAILED_PRECONDITION", status, body)
		}
		if status, _ := s.rpc(t, "/aedst.appattest.v1.AppAttestService/Enroll", token, "", map[string]any{"keyId": "x"}); status != http.StatusBadRequest {
			t.Errorf("Enroll with an invalid key id = %d, want 400 from protovalidate", status)
		}
		if status, body := s.rpc(t, "/aedst.media.v1.MediaService/ListMedia", token, "", map[string]any{}); body["code"] != "failed_precondition" {
			t.Errorf("ListMedia without storage = %d %v, want FAILED_PRECONDITION", status, body)
		}
		status, body := s.rpc(t, "/aedst.notifications.v1.NotificationsService/ListNotifications", token, "", map[string]any{"pageSize": 10})
		if status != http.StatusOK {
			t.Fatalf("ListNotifications = %d %v", status, body)
		}
		// The completed task's title is searchable once the projection caught up.
		deadline := time.Now().Add(10 * time.Second)
		for {
			status, body := s.rpc(t, "/aedst.search.v1.SearchService/Search", token, "", map[string]any{"query": "Ship"})
			if status == http.StatusOK && len(asSlice(body["hits"])) > 0 {
				break
			}
			if time.Now().After(deadline) {
				t.Fatalf("Search never found the task: %d %v", status, body)
			}
			time.Sleep(100 * time.Millisecond)
		}
	})

	t.Run("a Connect call without Connect-Protocol-Version is rejected", func(t *testing.T) {
		req, _ := http.NewRequest(http.MethodPost, s.base+"/aedst.tasks.v1.TasksService/GetTaskStats", strings.NewReader(`{}`))
		req.Header.Set("Content-Type", "application/json")
		req.Header.Set("Authorization", "Bearer "+token)
		resp, err := http.DefaultClient.Do(req)
		if err != nil {
			t.Fatal(err)
		}
		_ = resp.Body.Close()
		if resp.StatusCode == http.StatusOK {
			t.Fatal("request without the protocol header was served")
		}
		if resp.Header.Get("X-Content-Type-Options") != "nosniff" || resp.Header.Get("Permissions-Policy") == "" {
			t.Errorf("security headers missing: %v", resp.Header)
		}
	})

	t.Run("graceful shutdown returns cleanly", func(t *testing.T) {
		s.stop()
		select {
		case err := <-s.done:
			if err != nil {
				t.Fatalf("run() after cancellation = %v, want nil", err)
			}
			s.done <- nil // let the cleanup wait succeed
		case <-time.After(20 * time.Second):
			t.Fatal("server did not shut down")
		}
	})
}

// A role policy naming a procedure that does not exist would leave the real
// RPC open; the server must refuse to start instead.
func TestServer_RefusesToStartWithAnInvalidRolePolicy(t *testing.T) {
	for name, policy := range map[string]string{
		"typo in the procedure":   "/aedst.tasks.v1.TasksService/DeleteTsk=admin",
		"public procedure":        "/aedst.capabilities.v1.CapabilitiesService/GetCapabilities=admin",
		"policy without a role":   "/aedst.tasks.v1.TasksService/DeleteTask=",
		"unqualified procedure":   "DeleteTask=admin",
		"unknown service":         "/aedst.nope.v1.Missing/Do=admin",
		"trailing separator only": "/aedst.tasks.v1.TasksService/DeleteTask=|",
	} {
		t.Run(name, func(t *testing.T) {
			s := start(t, map[string]string{"AEDST_ROLE_POLICY": policy})
			select {
			case err := <-s.done:
				if err == nil {
					t.Fatal("run() returned nil for an invalid role policy")
				}
				s.done <- err
			case <-time.After(30 * time.Second):
				t.Fatalf("server kept running with policy %q", policy)
			}
		})
	}
}

func TestServer_RefusesToStartWithoutADatabase(t *testing.T) {
	t.Setenv("AEDST_DATABASE_URL", "postgres://nobody:nothing@127.0.0.1:1/none?sslmode=disable&connect_timeout=2")
	t.Setenv("AEDST_OIDC_ISSUER", idp(t).URL)
	t.Setenv("AEDST_OIDC_AUDIENCE", testAudience)
	t.Setenv("AEDST_HTTP_ADDR", freeAddr(t))
	t.Setenv("AEDST_LOG_LEVEL", "error")
	ctx, cancel := context.WithTimeout(context.Background(), 60*time.Second)
	defer cancel()
	if err := run(ctx); err == nil {
		t.Fatal("run() succeeded without a reachable database")
	} else if !strings.Contains(fmt.Sprint(err), "database") {
		t.Fatalf("error = %v, want it to name the database", err)
	}
}

func asSlice(v any) []any {
	s, _ := v.([]any)
	return s
}
