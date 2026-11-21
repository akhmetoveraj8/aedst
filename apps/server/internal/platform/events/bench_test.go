package events

import (
	"context"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// discardInserter accepts the jobs without a database, so the benchmark
// measures what Publish does before the insert: marshalling the payload and
// building one DeliveryArgs per consumer.
type discardInserter struct{ jobs int }

func (d *discardInserter) InsertManyTx(_ context.Context, _ pgx.Tx, params []river.InsertManyParams) ([]*rivertype.JobInsertResult, error) {
	d.jobs += len(params)
	return nil, nil
}

func BenchmarkPublishBuildsDeliveryArgs(b *testing.B) {
	registry := NewRegistry()
	noop := func(context.Context, Event) error { return nil }
	for _, name := range []string{"notifications.task_completed", "search.task_index", "audit.task_log"} {
		registry.Subscribe("tasks.v1.TaskCompleted", name, noop)
	}
	inserter := &discardInserter{}
	publisher := NewRiverPublisher(registry, inserter, sharedtime.Fixed{At: time.Date(2026, 3, 4, 5, 6, 7, 0, time.UTC)})
	payload := struct {
		TaskID string `json:"task_id"`
		UserID string `json:"user_id"`
		Title  string `json:"title"`
	}{ids.New().String(), ids.New().String(), "Write the quarterly report"}
	partition := ids.New()
	ctx := context.Background()
	b.ReportAllocs()
	for b.Loop() {
		if _, err := publisher.Publish(ctx, nil, "tasks.v1.TaskCompleted", 1, partition, payload); err != nil {
			b.Fatal(err)
		}
	}
	if inserter.jobs == 0 {
		b.Fatal("no delivery was built")
	}
}
