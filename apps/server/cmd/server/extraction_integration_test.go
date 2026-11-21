//go:build integration

package main

import (
	"net/http"
	"testing"

	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/shared/ids"
)

// TestExtraction_MediaReachesTasksInAnotherProcess is the extraction path of
// docs/content/server/architecture.md run for real: the same binary started
// twice with different environment. One process hosts only tasks
// (AEDST_MODULES=tasks), the other only media (AEDST_MODULES=media) and is told
// where tasks lives (AEDST_MODULE_TASKS_URL). Attaching an upload to a task
// makes media ask tasks "is this the caller's task?", which is now a Connect
// call between the two processes carrying the caller's own token.
//
// The database-free version of the same wiring (real transport, real Remote
// hook, in-memory storage) is internal/modules/tasks/module/extraction_test.go.
func TestExtraction_MediaReachesTasksInAnotherProcess(t *testing.T) {
	dsn := postgrestest.NewDatabase(t)
	postgrestest.Migrate(t, dsn, "tasks", "notifications", "search", "media", "admin", "integrity", "appattest")

	// startOn sets process-wide environment, so the first process must have read
	// its configuration (waitReady) before the second one's variables are set.
	tasks := startOn(t, dsn, map[string]string{"AEDST_MODULES": "tasks", "AEDST_JOBS_QUEUES": ""})
	tasks.waitReady(t)
	media := startOn(t, dsn, map[string]string{
		"AEDST_MODULES":          "media",
		"AEDST_MODULE_TASKS_URL": tasks.base,
		"AEDST_JOBS_QUEUES":      "",
		// Uploads must be enabled for CreateUpload to reach the ownership check. The
		// presigned URL is computed locally; nothing listens on the endpoint.
		"AEDST_STORAGE_PROVIDER":          "minio",
		"AEDST_STORAGE_ENDPOINT":          "http://127.0.0.1:9",
		"AEDST_STORAGE_BUCKET":            "extraction-test",
		"AEDST_STORAGE_REGION":            "us-east-1",
		"AEDST_STORAGE_ACCESS_KEY_ID":     "test",
		"AEDST_STORAGE_SECRET_ACCESS_KEY": "test-secret",
	})
	media.waitReady(t)

	alice := tasks.register(t, "extraction-alice@example.com")
	bob := tasks.register(t, "extraction-bob@example.com")

	// Each process serves only what it hosts.
	status, created := tasks.rpc(t, "/aedst.tasks.v1.TasksService/CreateTask", alice, "", map[string]any{"title": "Attach a file", "priority": "TASK_PRIORITY_LOW"})
	if status != http.StatusOK {
		t.Fatalf("CreateTask on the tasks process = %d %v", status, created)
	}
	taskID := created["task"].(map[string]any)["id"].(string)
	if status, _ := media.rpc(t, "/aedst.tasks.v1.TasksService/GetTask", alice, "", map[string]any{"id": taskID}); status != http.StatusNotFound {
		t.Fatalf("GetTask on the media process = %d, want 404: it must not host TasksService", status)
	}
	if status, _ := tasks.rpc(t, "/aedst.media.v1.MediaService/ListMedia", alice, "", map[string]any{}); status != http.StatusNotFound {
		t.Fatalf("ListMedia on the tasks process = %d, want 404: it must not host MediaService", status)
	}

	upload := func(token, task string) (int, map[string]any) {
		return media.rpc(t, "/aedst.media.v1.MediaService/CreateUpload", token, "", map[string]any{
			"filename": "note.txt", "contentType": "text/plain", "sizeBytes": 12, "taskId": task,
		})
	}
	// The owner: media asked the tasks process and was told yes.
	if status, body := upload(alice, taskID); status != http.StatusOK {
		t.Fatalf("CreateUpload for the owner's task = %d %v, want 200 (ownership answered by the tasks process)", status, body)
	}
	// Someone else's task and a task that does not exist give the same answer.
	if status, body := upload(bob, taskID); body["code"] != "not_found" {
		t.Fatalf("CreateUpload for another user's task = %d %v, want not_found", status, body)
	}
	if status, body := upload(alice, ids.New().String()); body["code"] != "not_found" {
		t.Fatalf("CreateUpload for a missing task = %d %v, want not_found", status, body)
	}
}
