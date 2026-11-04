//go:build integration

package postgres_test

import (
	"bytes"
	"context"
	"image"
	"image/png"
	"log/slog"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/modules/media/api"
	"github.com/aedst/server/internal/modules/media/application"
	"github.com/aedst/server/internal/modules/media/domain"
	mediajobs "github.com/aedst/server/internal/modules/media/infrastructure/jobs"
	"github.com/aedst/server/internal/modules/media/infrastructure/postgres"
	"github.com/aedst/server/internal/modules/media/infrastructure/processing"
	"github.com/aedst/server/internal/platform/events/eventstest"
	"github.com/aedst/server/internal/platform/postgrestest"
	"github.com/aedst/server/internal/platform/storage"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

type owns struct{}

func (owns) OwnsTask(context.Context, ids.ID, ids.ID) (bool, error) { return true, nil }

func TestMedia_UploadProcessReadyDeleteAndRetention(t *testing.T) {
	if !processing.ImagingBuiltIn {
		t.Skip("processes a real image: needs libvips (-tags vips); run by `task test:vips:integration` (CI job unit-vips)")
	}
	pool := postgrestest.NewPool(t, "media")
	objects := storage.NewMemory()
	logger := slog.New(slog.DiscardHandler)
	// Insert-only River client (never started) whose workers include the media
	// ones; a capturing consumer makes the published events observable as
	// delivery jobs.
	rt := eventstest.New(t, pool, func(workers *river.Workers) {
		river.AddWorker(workers, processing.NewWorker(nil, objects, processing.Config{}, logger))
		river.AddWorker(workers, processing.NewDeleteWorker(objects))
	}).Capture(api.MediaReadyEventType, api.MediaDeletedEventType)
	clock := sharedtime.Real{}
	repo := postgres.NewRepository(pool, rt.Client, rt.Publisher, clock)
	svc := application.NewService(repo, objects, owns{}, clock, application.Config{
		Limits:       domain.Limits{MaxImageBytes: 1 << 20, MaxDocumentBytes: 1 << 20},
		UploadURLTTL: time.Minute, DownloadURLTTL: time.Minute,
	}, true)
	ctx := context.Background()
	owner := ids.New()
	count := func(query string, args ...any) (n int) {
		t.Helper()
		if err := pool.QueryRow(ctx, query, args...).Scan(&n); err != nil {
			t.Fatal(err)
		}
		return n
	}

	var buf bytes.Buffer
	_ = png.Encode(&buf, image.NewRGBA(image.Rect(0, 0, 400, 200)))
	data := buf.Bytes()
	task := ids.New()
	up, err := svc.CreateUpload(ctx, owner, "chart.png", "image/png", int64(len(data)), "", &task)
	if err != nil {
		t.Fatal(err)
	}
	_ = objects.Put(ctx, up.Media.ObjectKey, bytes.NewReader(data), int64(len(data)), "image/png")
	for range 2 { // second call is a no-op
		if _, err := svc.CompleteUpload(ctx, owner, up.Media.ID); err != nil {
			t.Fatal(err)
		}
	}
	if n := count(`SELECT count(*) FROM river_job WHERE kind = 'media.process' AND queue = 'media'`); n != 1 {
		t.Fatalf("processing jobs on the media queue = %d, want 1", n)
	}

	// Run the processing worker directly against the real repository.
	worker := processing.NewWorker(repo, objects, processing.Config{MaxImagePixels: 1e8}, logger)
	job := &river.Job[mediajobs.ProcessArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 5}, Args: mediajobs.ProcessArgs{MediaID: up.Media.ID.String()}}
	for range 2 { // retry after success publishes nothing new
		if err := worker.Work(ctx, job); err != nil {
			t.Fatal(err)
		}
	}
	m, err := svc.GetMedia(ctx, owner, up.Media.ID)
	if err != nil || m.Status != domain.StatusReady || m.Width != 400 || len(m.Variants) != 0 || m.TaskID == nil || *m.TaskID != task {
		t.Fatalf("media = %+v, %v", m, err)
	}
	if n := count(`SELECT count(*) FROM river_job WHERE kind = 'platform.event_delivery' AND args->>'event_type' = $1`, api.MediaReadyEventType); n != 1 {
		t.Fatalf("MediaReady rows = %d, want 1", n)
	}
	links, err := svc.Links(ctx, m)
	if err != nil || links.Original == "" {
		t.Fatalf("links = %+v, %v", links, err)
	}

	list, err := svc.ListMedia(ctx, owner, &task, nil, 10, "")
	if err != nil || len(list.Media) != 1 {
		t.Fatalf("ListMedia by task = %+v, %v", list, err)
	}
	if _, err := svc.GetMedia(ctx, ids.New(), up.Media.ID); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Errorf("another user's media: %v", err)
	}

	if err := svc.DeleteMedia(ctx, owner, up.Media.ID); err != nil {
		t.Fatal(err)
	}
	if n := count(`SELECT count(*) FROM river_job WHERE kind = 'platform.event_delivery' AND args->>'event_type' = $1`, api.MediaDeletedEventType); n != 1 {
		t.Errorf("MediaDeleted rows = %d", n)
	}
	if n := count(`SELECT count(*) FROM river_job WHERE kind = 'media.delete_objects'`); n != 1 {
		t.Errorf("cleanup jobs = %d", n)
	}

	// Abandoned upload: purged by retention with its object scheduled for deletion.
	abandoned, err := svc.CreateUpload(ctx, owner, "notes.txt", "text/plain", 5, "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if n, err := repo.PurgeAbandoned(ctx, time.Now().Add(-time.Hour), 100); err != nil || n != 0 {
		t.Fatalf("fresh upload purged: %d, %v", n, err)
	}
	if n, err := repo.PurgeAbandoned(ctx, time.Now().Add(time.Hour), 100); err != nil || n != 1 {
		t.Fatalf("PurgeAbandoned = %d, %v", n, err)
	}
	if _, err := svc.GetMedia(ctx, owner, abandoned.Media.ID); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Errorf("abandoned row survived: %v", err)
	}
	if n := count(`SELECT count(*) FROM river_job WHERE kind = 'media.delete_objects'`); n != 2 {
		t.Errorf("cleanup jobs after purge = %d, want 2", n)
	}
	if total, bytes, err := repo.Totals(ctx); err != nil || total != 0 || bytes != 0 {
		t.Errorf("Totals = %d %d %v", total, bytes, err)
	}
}
