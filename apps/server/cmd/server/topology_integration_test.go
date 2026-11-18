//go:build integration

package main

import (
	"context"
	"net/http"
	"testing"
	"time"

	"github.com/aedst/server/internal/platform/postgrestest"
)

// TestTopology_APIInsertsAndAnotherProcessDelivers pins the claim behind the
// worker Deployments (docs/content/server/scaling.md): River is the only async
// mechanism, so an insert-only API replica and a worker replica on one Postgres
// behave as one system. The API completes a task; its event delivery waits in
// river_job (the API never works queues) until a second process that does work
// them picks it up, creates the notification, and the API's user sees it.
func TestTopology_APIInsertsAndAnotherProcessDelivers(t *testing.T) {
	for name, workerEnv := range map[string]map[string]string{
		"listen/notify": {"AEDST_JOBS_QUEUES": "default=5"},
		"poll-only":     {"AEDST_JOBS_QUEUES": "default=5", "AEDST_JOBS_POLL_ONLY": "true"},
	} {
		t.Run(name, func(t *testing.T) {
			dsn := postgrestest.NewDatabase(t)
			postgrestest.Migrate(t, dsn, "tasks", "notifications", "search", "media", "admin", "integrity", "appattest")
			pool := postgrestest.Connect(t, dsn)
			count := func(query string) (n int) {
				t.Helper()
				if err := pool.QueryRow(context.Background(), query).Scan(&n); err != nil {
					t.Fatalf("%s: %v", query, err)
				}
				return n
			}
			const deliveries = "SELECT count(*) FROM river_job WHERE kind = 'platform.event_delivery' AND args->>'consumer' = 'notifications.task_completed'"

			api := startOn(t, dsn, map[string]string{"AEDST_JOBS_QUEUES": ""}) // insert-only
			api.waitReady(t)
			token := api.register(t, "topology-"+name[:4]+"@example.com")
			status, created := api.rpc(t, "/aedst.tasks.v1.TasksService/CreateTask", token, "", map[string]any{"title": "Ship the topology test", "priority": "TASK_PRIORITY_HIGH"})
			if status != http.StatusOK {
				t.Fatalf("CreateTask = %d %v", status, created)
			}
			id := created["task"].(map[string]any)["id"].(string)
			if status, body := api.rpc(t, "/aedst.tasks.v1.TasksService/CompleteTask", token, "", map[string]any{"id": id}); status != http.StatusOK {
				t.Fatalf("CompleteTask = %d %v", status, body)
			}

			if n := count(deliveries + " AND state = 'available'"); n != 1 {
				t.Fatalf("available delivery jobs = %d right after CompleteTask, want 1 (committed with the state change)", n)
			}
			// Each consumer unit has its own queue, so a worker hosting only that unit
			// can take exactly its deliveries (platform/events.QueueFor).
			if n := count(deliveries + " AND queue = 'events_notifications'"); n != 1 {
				t.Fatalf("deliveries on events_notifications = %d, want 1 (a delivery goes to its consumer unit's queue)", n)
			}
			time.Sleep(3 * time.Second) // an API that worked queues would have delivered by now
			if n := count("SELECT count(*) FROM notifications.notifications"); n != 0 {
				t.Fatalf("notifications = %d before any worker runs: the insert-only API delivered events itself", n)
			}

			worker := startOn(t, dsn, workerEnv)
			worker.waitReady(t)
			deadline := time.Now().Add(30 * time.Second)
			for count(deliveries+" AND state = 'completed'") == 0 {
				if time.Now().After(deadline) {
					t.Fatal("the worker never completed the delivery")
				}
				time.Sleep(100 * time.Millisecond)
			}
			if n := count("SELECT count(*) FROM notifications.notifications"); n != 1 {
				t.Fatalf("notifications = %d after delivery, want exactly 1", n)
			}
			// The user reads it through the API replica that never ran the consumer.
			status, listed := api.rpc(t, "/aedst.notifications.v1.NotificationsService/ListNotifications", token, "", map[string]any{"pageSize": 10})
			if status != http.StatusOK || len(asSlice(listed["notifications"])) != 1 {
				t.Fatalf("ListNotifications via the API = %d %v, want one notification", status, listed)
			}
		})
	}
}
