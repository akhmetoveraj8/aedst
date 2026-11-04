//go:build integration

package main

import (
	"net/http"
	"testing"
)

// The offline outbox of every client replays its queued writes with the item id
// as Idempotency-Key. Through the real server: a replay returns the first
// response and writes once, for each write RPC that is not naturally idempotent.
func TestServer_QueuedWritesAreReplaySafe(t *testing.T) {
	s := start(t, nil)
	s.waitReady(t)
	token := s.register(t, "outbox@example.com")

	status, body := s.rpc(t, "/aedst.tasks.v1.TasksService/CreateTask", token, "item-create", map[string]any{"title": "Offline", "priority": "TASK_PRIORITY_LOW"})
	if status != http.StatusOK {
		t.Fatalf("CreateTask = %d %v", status, body)
	}
	task := body["task"].(map[string]any)
	id, version := task["id"].(string), task["version"]

	update := map[string]any{"id": id, "title": "Edited offline", "updateMask": "title", "expectedVersion": version}
	status, first := s.rpc(t, "/aedst.tasks.v1.TasksService/UpdateTask", token, "item-update", update)
	if status != http.StatusOK {
		t.Fatalf("UpdateTask = %d %v", status, first)
	}
	// The retry's expected version is stale by now; the key makes it a replay.
	status, second := s.rpc(t, "/aedst.tasks.v1.TasksService/UpdateTask", token, "item-update", update)
	if status != http.StatusOK || second["task"].(map[string]any)["version"] != first["task"].(map[string]any)["version"] {
		t.Fatalf("replayed UpdateTask = %d %v, want the first response %v", status, second, first)
	}
	if status, body = s.rpc(t, "/aedst.tasks.v1.TasksService/UpdateTask", token, "", update); status != http.StatusConflict {
		t.Fatalf("keyless stale UpdateTask = %d %v, want 409", status, body)
	}
	if status, body = s.rpc(t, "/aedst.tasks.v1.TasksService/UpdateTask", token, "item-update", map[string]any{"id": id, "title": "Different", "updateMask": "title"}); status != http.StatusConflict {
		t.Fatalf("UpdateTask reusing a key for another request = %d %v, want 409", status, body)
	}

	for i := range 2 {
		if status, body = s.rpc(t, "/aedst.tasks.v1.TasksService/CompleteTask", token, "item-complete", map[string]any{"id": id}); status != http.StatusOK {
			t.Fatalf("CompleteTask #%d = %d %v", i, status, body)
		}
	}
	for i := range 2 {
		if status, body = s.rpc(t, "/aedst.tasks.v1.TasksService/DeleteTask", token, "item-delete", map[string]any{"id": id}); status != http.StatusOK {
			t.Fatalf("DeleteTask #%d with the same key = %d %v, want 200 both times", i, status, body)
		}
	}
	if status, _ = s.rpc(t, "/aedst.tasks.v1.TasksService/GetTask", token, "", map[string]any{"id": id}); status != http.StatusNotFound {
		t.Fatalf("GetTask after delete = %d, want 404", status)
	}
}
