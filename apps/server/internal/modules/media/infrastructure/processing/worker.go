package processing

import (
	"bytes"
	"context"
	"errors"
	"fmt"
	"io"
	"log/slog"
	"os"
	"time"

	"github.com/riverqueue/river"

	"github.com/aedst/server/internal/modules/media/domain"
	mediajobs "github.com/aedst/server/internal/modules/media/infrastructure/jobs"
	platformjobs "github.com/aedst/server/internal/platform/jobs"
	"github.com/aedst/server/internal/platform/storage"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// Store is what the processing worker needs from the repository.
type Store interface {
	GetByID(ctx context.Context, id ids.ID) (domain.Media, error)
	MarkReady(ctx context.Context, id ids.ID, width, height int, durationMs int64, variants []domain.Variant) error
	MarkFailed(ctx context.Context, id ids.ID, reason string, now time.Time) error
}

// Config bounds processing.
type Config struct {
	MaxImagePixels int64
	// MaxImageBytes caps what an image download may read. A retried job sees
	// the already-sanitized original, whose size differs from the uploaded
	// one, so images are bounded by this cap instead of the exact size.
	MaxImageBytes int64
	// Images sanitizes images; nil selects NewImageProcessor() (libvips when
	// built with -tags vips, otherwise a stub returning ErrImagingUnavailable).
	Images ImageProcessor
	FFmpeg FFmpeg
	// Clock stamps failures; nil selects the system clock.
	Clock sharedtime.Clock
}

func (w *Worker) now() time.Time {
	if w.cfg.Clock != nil {
		return w.cfg.Clock.Now()
	}
	return sharedtime.Real{}.Now()
}

func (w *Worker) images() ImageProcessor {
	if w.cfg.Images != nil {
		return w.cfg.Images
	}
	return NewImageProcessor()
}

// Worker runs mediajobs.ProcessArgs on the "media" queue.
type Worker struct {
	river.WorkerDefaults[mediajobs.ProcessArgs]
	store   Store
	objects storage.ObjectStorage
	cfg     Config
	logger  *slog.Logger
}

func NewWorker(store Store, objects storage.ObjectStorage, cfg Config, logger *slog.Logger) *Worker {
	return &Worker{store: store, objects: objects, cfg: cfg, logger: logger}
}

// Timeout covers download, decode/ffmpeg and variant uploads.
func (w *Worker) Timeout(*river.Job[mediajobs.ProcessArgs]) time.Duration {
	return platformjobs.MaxJobTimeout
}

func (w *Worker) Work(ctx context.Context, job *river.Job[mediajobs.ProcessArgs]) error {
	id, err := ids.Parse(job.Args.MediaID)
	if err != nil {
		return river.JobCancel(err)
	}
	m, err := w.store.GetByID(ctx, id)
	if err != nil {
		return err
	}
	if m.Status != domain.StatusProcessing {
		return nil // already done (retry after commit) or deleted/failed
	}

	err = w.process(ctx, m)
	switch {
	case err == nil:
		return nil
	case errors.Is(err, ErrUnprocessable):
		w.logger.InfoContext(ctx, "media: unprocessable upload", slog.String("media_id", id.String()), slog.Any("reason", err))
		if markErr := w.store.MarkFailed(ctx, id, "the file could not be processed", w.now()); markErr != nil {
			return markErr
		}
		return river.JobCancel(err)
	default:
		if job.Attempt >= job.MaxAttempts {
			_ = w.store.MarkFailed(ctx, id, "processing failed", w.now())
		}
		return err
	}
}

func (w *Worker) process(ctx context.Context, m domain.Media) error {
	if m.Kind == domain.KindDocument || (m.Kind != domain.KindImage && !w.cfg.FFmpeg.Enabled()) {
		return w.store.MarkReady(ctx, m.ID, 0, 0, 0, nil)
	}
	path, err := w.download(ctx, m)
	if err != nil {
		return err
	}
	defer func() { _ = os.Remove(path) }()

	switch m.Kind {
	case domain.KindImage:
		data, err := os.ReadFile(path) //nolint:gosec // G304: path is the temp file this worker downloaded into
		if err != nil {
			return fmt.Errorf("media: read: %w", err)
		}
		res, err := w.images().Sanitize(ctx, data, m.ContentType, w.cfg.MaxImagePixels)
		if err != nil {
			return err
		}
		if res.Changed {
			// Replace the raw upload (which may carry EXIF/GPS) with the
			// sanitized original under the same key. Delivery variants are
			// not pre-generated: imgproxy makes them on demand.
			if err := w.objects.Put(ctx, m.ObjectKey, bytes.NewReader(res.Data), int64(len(res.Data)), res.ContentType); err != nil {
				return fmt.Errorf("media: store sanitized original: %w", err)
			}
		}
		return w.store.MarkReady(ctx, m.ID, res.Width, res.Height, 0, nil)
	case domain.KindVideo:
		probe, err := w.cfg.FFmpeg.Probe(ctx, path)
		if err != nil {
			return err
		}
		encoded, err := w.cfg.FFmpeg.Poster(ctx, path, probe.DurationMs)
		if err != nil {
			return err
		}
		variants, err := w.storeVariants(ctx, m, encoded)
		if err != nil {
			return err
		}
		return w.store.MarkReady(ctx, m.ID, probe.Width, probe.Height, probe.DurationMs, variants)
	default: // audio
		probe, err := w.cfg.FFmpeg.Probe(ctx, path)
		if err != nil {
			return err
		}
		return w.store.MarkReady(ctx, m.ID, 0, 0, probe.DurationMs, nil)
	}
}

// download copies the original to a temp file, never reading more than the
// verified size (+1 to detect a changed object).
func (w *Worker) download(ctx context.Context, m domain.Media) (string, error) {
	body, _, err := w.objects.Get(ctx, m.ObjectKey)
	if errors.Is(err, storage.ErrNotFound) {
		return "", fmt.Errorf("%w: original object is gone", ErrUnprocessable)
	}
	if err != nil {
		return "", fmt.Errorf("media: download: %w", err)
	}
	defer func() { _ = body.Close() }()
	f, err := os.CreateTemp("", "aedst-media-*")
	if err != nil {
		return "", fmt.Errorf("media: temp: %w", err)
	}
	limit, strict := m.SizeBytes, true
	if m.Kind == domain.KindImage {
		// Image content is fully re-validated by the sanitizer, and a retry
		// after a successful overwrite sees different bytes (see Config).
		limit, strict = max(limit, w.cfg.MaxImageBytes), false
	}
	n, copyErr := io.Copy(f, io.LimitReader(body, limit+1))
	closeErr := f.Close()
	if copyErr != nil || closeErr != nil {
		_ = os.Remove(f.Name())
		return "", fmt.Errorf("media: download: %w", errors.Join(copyErr, closeErr))
	}
	if n > limit || (strict && n != m.SizeBytes) {
		_ = os.Remove(f.Name())
		return "", fmt.Errorf("%w: object size changed after verification", ErrUnprocessable)
	}
	return f.Name(), nil
}

// storeVariants uploads encoded variants under the item's prefix.
func (w *Worker) storeVariants(ctx context.Context, m domain.Media, encoded []Encoded) ([]domain.Variant, error) {
	out := make([]domain.Variant, 0, len(encoded))
	for _, e := range encoded {
		key := domain.ObjectKey(m.OwnerID, m.ID, e.Name+"."+e.Ext)
		if err := w.objects.Put(ctx, key, bytes.NewReader(e.Data), int64(len(e.Data)), e.ContentType); err != nil {
			return nil, fmt.Errorf("media: store variant: %w", err)
		}
		out = append(out, domain.Variant{
			Kind: domain.VariantKind(e.Name), ObjectKey: key, ContentType: e.ContentType,
			Width: e.Width, Height: e.Height, SizeBytes: int64(len(e.Data)),
		})
	}
	return out, nil
}

// DeleteWorker runs mediajobs.DeleteObjectsArgs.
type DeleteWorker struct {
	river.WorkerDefaults[mediajobs.DeleteObjectsArgs]
	objects storage.ObjectStorage
}

func NewDeleteWorker(objects storage.ObjectStorage) *DeleteWorker {
	return &DeleteWorker{objects: objects}
}

func (w *DeleteWorker) Work(ctx context.Context, job *river.Job[mediajobs.DeleteObjectsArgs]) error {
	var errs []error
	for _, key := range job.Args.Keys {
		if err := w.objects.Delete(ctx, key); err != nil && !errors.Is(err, storage.ErrNotFound) {
			errs = append(errs, err)
		}
	}
	return errors.Join(errs...)
}
