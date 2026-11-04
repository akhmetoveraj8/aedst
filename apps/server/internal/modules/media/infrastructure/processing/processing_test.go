package processing_test

import (
	"bytes"
	"context"
	"errors"
	"log/slog"
	"os/exec"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/modules/media/domain"
	mediajobs "github.com/aedst/server/internal/modules/media/infrastructure/jobs"
	"github.com/aedst/server/internal/modules/media/infrastructure/processing"
	"github.com/aedst/server/internal/platform/storage"
	"github.com/aedst/server/internal/shared/ids"
)

// fakeImages stands in for libvips so the worker is tested in default builds.
type fakeImages struct {
	res   processing.Sanitized
	err   error
	calls int
	gotCT string
}

func (f *fakeImages) Sanitize(_ context.Context, _ []byte, ct string, _ int64) (processing.Sanitized, error) {
	f.calls++
	f.gotCT = ct
	return f.res, f.err
}

type fakeStore struct {
	m        domain.Media
	ready    bool
	variants []domain.Variant
	width    int
	failed   string
}

func (f *fakeStore) GetByID(context.Context, ids.ID) (domain.Media, error) { return f.m, nil }
func (f *fakeStore) MarkReady(_ context.Context, _ ids.ID, w, _ int, _ int64, v []domain.Variant) error {
	f.ready, f.variants, f.width = true, v, w
	return nil
}

func (f *fakeStore) MarkFailed(_ context.Context, _ ids.ID, reason string, _ time.Time) error {
	f.failed = reason
	return nil
}

func run(t *testing.T, w *processing.Worker, id ids.ID) error {
	t.Helper()
	return w.Work(context.Background(), &river.Job[mediajobs.ProcessArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 5}, Args: mediajobs.ProcessArgs{MediaID: id.String()}})
}

func newImageFixture(t *testing.T, fake *fakeImages) (*processing.Worker, *fakeStore, *storage.Memory, ids.ID, string) {
	t.Helper()
	objects := storage.NewMemory()
	owner, id := ids.New(), ids.New()
	data := []byte("raw-upload-with-gps")
	key := domain.ObjectKey(owner, id, "original")
	_ = objects.Put(context.Background(), key, bytes.NewReader(data), int64(len(data)), "image/jpeg")
	store := &fakeStore{m: domain.Media{ID: id, OwnerID: owner, Kind: domain.KindImage, Status: domain.StatusProcessing, ContentType: "image/jpeg", ObjectKey: key, SizeBytes: int64(len(data))}}
	cfg := processing.Config{MaxImagePixels: 50_000_000, MaxImageBytes: 1 << 20}
	if fake != nil { // a typed nil must not become a non-nil interface
		cfg.Images = fake
	}
	w := processing.NewWorker(store, objects, cfg, slog.New(slog.DiscardHandler))
	return w, store, objects, id, key
}

func TestWorker_ImageSanitizesOriginalAndStoresNoVariants(t *testing.T) {
	fake := &fakeImages{res: processing.Sanitized{Width: 600, Height: 300, Changed: true, ContentType: "image/jpeg", Data: []byte("clean")}}
	w, store, objects, id, key := newImageFixture(t, fake)

	if err := run(t, w, id); err != nil || !store.ready || store.width != 600 {
		t.Fatalf("Work = %v, ready %v, width %d", err, store.ready, store.width)
	}
	if len(store.variants) != 0 {
		t.Errorf("generic renditions must not be pre-generated (imgproxy does it): %v", store.variants)
	}
	if keys := objects.Keys(); len(keys) != 1 || keys[0] != key {
		t.Errorf("stored objects = %v, want only the original", keys)
	}
	body, _, err := objects.Get(context.Background(), key)
	if err != nil {
		t.Fatal(err)
	}
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(body)
	if buf.String() != "clean" {
		t.Errorf("original not replaced by the sanitized bytes: %q", buf.String())
	}
	if fake.gotCT != "image/jpeg" {
		t.Errorf("processor got content type %q", fake.gotCT)
	}

	// A retried job after success does nothing.
	store.m.Status, store.ready, fake.calls = domain.StatusReady, false, 0
	if err := run(t, w, id); err != nil || store.ready || fake.calls != 0 {
		t.Fatal("a retried job after success must do nothing")
	}
}

func TestWorker_UnchangedImageIsNotRewritten(t *testing.T) {
	fake := &fakeImages{res: processing.Sanitized{Width: 10, Height: 10}} // e.g. animated GIF
	w, store, objects, id, key := newImageFixture(t, fake)
	if err := run(t, w, id); err != nil || !store.ready {
		t.Fatalf("Work = %v", err)
	}
	body, _, _ := objects.Get(context.Background(), key)
	buf := new(bytes.Buffer)
	_, _ = buf.ReadFrom(body)
	if buf.String() != "raw-upload-with-gps" {
		t.Errorf("original was rewritten: %q", buf.String())
	}
}

func TestWorker_UnprocessableImageFailsAndCancels(t *testing.T) {
	w, store, _, id, _ := newImageFixture(t, &fakeImages{err: processing.ErrUnprocessable})
	err := run(t, w, id)
	var cancel *rivertype.JobCancelError
	if !errors.As(err, &cancel) || store.failed == "" || store.ready {
		t.Fatalf("err %v, failed %q, ready %v; want FAILED and a cancelled job", err, store.failed, store.ready)
	}
}

// Runs only where ffmpeg/ffprobe are installed (CI images may not have them).
func TestFFmpeg_PosterAndProbe(t *testing.T) {
	ffmpeg, err1 := exec.LookPath("ffmpeg")
	ffprobe, err2 := exec.LookPath("ffprobe")
	if err1 != nil || err2 != nil {
		t.Skip("ffmpeg/ffprobe not installed")
	}
	dir := t.TempDir()
	clip := dir + "/clip.mp4"
	if out, err := exec.Command(ffmpeg, "-v", "error", "-f", "lavfi", "-i", "testsrc=duration=3:size=320x240:rate=10", "-pix_fmt", "yuv420p", clip).CombinedOutput(); err != nil {
		t.Skipf("cannot synthesize a clip: %v %s", err, out)
	}
	f := processing.FFmpeg{FFmpegPath: ffmpeg, FFprobePath: ffprobe, Timeout: 30 * time.Second}
	probe, err := f.Probe(context.Background(), clip)
	if err != nil || probe.Width != 320 || probe.Height != 240 || probe.DurationMs < 2500 {
		t.Fatalf("probe = %+v, %v", probe, err)
	}
	variants, err := f.Poster(context.Background(), clip, probe.DurationMs)
	if err != nil || len(variants) != 1 || variants[0].Name != "poster" || variants[0].Width != 320 {
		t.Fatalf("poster = %+v, %v", variants, err)
	}
}
