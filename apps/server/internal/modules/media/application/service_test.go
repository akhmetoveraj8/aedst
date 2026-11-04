package application_test

import (
	"bytes"
	"context"
	"image"
	"image/color"
	"image/png"
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/media/application"
	"github.com/aedst/server/internal/modules/media/domain"
	"github.com/aedst/server/internal/platform/storage"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

type fakeRepo struct {
	items   map[ids.ID]domain.Media
	started int
	failed  string
	deleted bool
}

func newRepo() *fakeRepo { return &fakeRepo{items: map[ids.ID]domain.Media{}} }

func (f *fakeRepo) Create(_ context.Context, m domain.Media) (domain.Media, error) {
	f.items[m.ID] = m
	return m, nil
}

func (f *fakeRepo) Get(_ context.Context, owner, id ids.ID) (domain.Media, error) {
	m, ok := f.items[id]
	if !ok || m.OwnerID != owner {
		return domain.Media{}, sharederrors.NotFound("test", "media not found")
	}
	return m, nil
}

func (f *fakeRepo) StartProcessing(_ context.Context, _, id ids.ID, size int64, _ time.Time) (domain.Media, bool, error) {
	m := f.items[id]
	if m.Status != domain.StatusPendingUpload {
		return domain.Media{}, false, nil
	}
	f.started++
	m.Status, m.SizeBytes = domain.StatusProcessing, size
	f.items[id] = m
	return m, true, nil
}

func (f *fakeRepo) MarkFailed(_ context.Context, id ids.ID, reason string, _ time.Time) error {
	m := f.items[id]
	m.Status, m.FailureReason = domain.StatusFailed, reason
	f.items[id] = m
	f.failed = reason
	return nil
}

func (f *fakeRepo) Delete(context.Context, ids.ID, ids.ID, time.Time) error {
	f.deleted = true
	return nil
}

func (f *fakeRepo) List(context.Context, application.ListParams) (application.ListResult, error) {
	return application.ListResult{}, nil
}
func (f *fakeRepo) Totals(context.Context) (int64, int64, error) { return 0, 0, nil }

type ownership map[ids.ID]bool

func (o ownership) OwnsTask(_ context.Context, _, task ids.ID) (bool, error) { return o[task], nil }

var limits = domain.Limits{MaxImageBytes: 1 << 20, MaxVideoBytes: 1 << 20, MaxAudioBytes: 1 << 20, MaxDocumentBytes: 1 << 20}

func newService(repo *fakeRepo, store storage.ObjectStorage, tasks ownership) *application.Service {
	return application.NewService(repo, store, tasks, sharedtime.Fixed{At: time.Now()},
		application.Config{Limits: limits, UploadURLTTL: time.Minute, DownloadURLTTL: time.Minute}, true)
}

func pngBytes(t *testing.T) []byte {
	t.Helper()
	img := image.NewRGBA(image.Rect(0, 0, 4, 4))
	img.Set(1, 1, color.RGBA{R: 255, A: 255})
	var buf bytes.Buffer
	if err := png.Encode(&buf, img); err != nil {
		t.Fatal(err)
	}
	return buf.Bytes()
}

func TestCreateUpload_PolicyAndAttachmentOwnership(t *testing.T) {
	repo, store := newRepo(), storage.NewMemory()
	mine := ids.New()
	svc := newService(repo, store, ownership{mine: true})
	owner := ids.New()

	if _, err := svc.CreateUpload(context.Background(), owner, "a.svg", "image/svg+xml", 10, "", nil); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("svg: %v, want Validation (not on the allow-list)", err)
	}
	if _, err := svc.CreateUpload(context.Background(), owner, "big.png", "image/png", limits.MaxImageBytes+1, "", nil); sharederrors.KindOf(err) != sharederrors.KindValidation {
		t.Errorf("oversize: %v", err)
	}
	other := ids.New()
	if _, err := svc.CreateUpload(context.Background(), owner, "a.png", "image/png", 10, "", &other); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Errorf("someone else's task: %v, want NotFound", err)
	}
	up, err := svc.CreateUpload(context.Background(), owner, "../../etc/a.png", "image/PNG; charset=x", 10, strings.Repeat("ab", 32), &mine)
	if err != nil {
		t.Fatal(err)
	}
	if up.Media.Filename != "a.png" || up.Media.ContentType != "image/png" || up.Media.Status != domain.StatusPendingUpload {
		t.Errorf("media = %+v", up.Media)
	}
	if !strings.HasPrefix(up.Media.ObjectKey, "media/"+owner.String()+"/") || up.Request.Method != "PUT" {
		t.Errorf("key %q / request %+v", up.Media.ObjectKey, up.Request)
	}
}

func TestCompleteUpload_VerifiesThenStartsOnce(t *testing.T) {
	repo, store := newRepo(), storage.NewMemory()
	svc := newService(repo, store, nil)
	owner := ids.New()
	data := pngBytes(t)
	ctx := context.Background()

	up, err := svc.CreateUpload(ctx, owner, "a.png", "image/png", int64(len(data)), "", nil)
	if err != nil {
		t.Fatal(err)
	}
	if _, err := svc.CompleteUpload(ctx, owner, up.Media.ID); sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition {
		t.Fatalf("before upload: %v, want FailedPrecondition", err)
	}
	_ = store.Put(ctx, up.Media.ObjectKey, bytes.NewReader(data), int64(len(data)), "image/png")
	m, err := svc.CompleteUpload(ctx, owner, up.Media.ID)
	if err != nil || m.Status != domain.StatusProcessing {
		t.Fatalf("CompleteUpload = %+v, %v", m, err)
	}
	if _, err := svc.CompleteUpload(ctx, owner, up.Media.ID); err != nil || repo.started != 1 {
		t.Fatalf("a repeated CompleteUpload must not start processing twice (started %d, %v)", repo.started, err)
	}
	if _, err := svc.CompleteUpload(ctx, ids.New(), up.Media.ID); sharederrors.KindOf(err) != sharederrors.KindNotFound {
		t.Errorf("another user: %v, want NotFound", err)
	}
}

func TestCompleteUpload_RejectsWrongSizeAndSpoofedType(t *testing.T) {
	ctx := context.Background()
	for name, body := range map[string][]byte{
		"size mismatch": []byte("short"),
		"html as png":   []byte("<html><script>alert(1)</script></html>  padding to size"),
	} {
		t.Run(name, func(t *testing.T) {
			repo, store := newRepo(), storage.NewMemory()
			svc := newService(repo, store, nil)
			owner := ids.New()
			declared := int64(len(body))
			if name == "size mismatch" {
				declared = 100
			}
			up, err := svc.CreateUpload(ctx, owner, "a.png", "image/png", declared, "", nil)
			if err != nil {
				t.Fatal(err)
			}
			_ = store.Put(ctx, up.Media.ObjectKey, bytes.NewReader(body), int64(len(body)), "image/png")
			m, err := svc.CompleteUpload(ctx, owner, up.Media.ID)
			if err != nil || m.Status != domain.StatusFailed || repo.started != 0 {
				t.Fatalf("got %+v, %v; want FAILED without processing", m, err)
			}
			if len(store.Keys()) != 0 {
				t.Error("the rejected object must be deleted")
			}
		})
	}
}

func TestDisabledStorage(t *testing.T) {
	svc := application.NewService(newRepo(), storage.Disabled{}, nil, sharedtime.Real{}, application.Config{}, false)
	if _, err := svc.CreateUpload(context.Background(), ids.New(), "a.png", "image/png", 1, "", nil); sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition {
		t.Fatalf("err = %v, want FailedPrecondition", err)
	}
}

func TestDomain_SniffAndFilename(t *testing.T) {
	cases := map[[2]string]bool{
		{"image/png", "image/png"}:                  true,
		{"image/png", "text/html; charset=utf-8"}:   false,
		{"video/quicktime", "video/mp4"}:            true,
		{"text/plain", "text/plain; charset=utf-8"}: true,
		{"application/pdf", "text/plain"}:           false,
	}
	for in, want := range cases {
		if got := domain.SniffMatches(in[0], in[1]); got != want {
			t.Errorf("SniffMatches(%q, %q) = %v", in[0], in[1], got)
		}
	}
	if n, err := domain.SanitizeFilename("C:\\Users\\x\\re\"port\x00.pdf"); err != nil || n != "report.pdf" {
		t.Errorf("SanitizeFilename = %q, %v", n, err)
	}
	if _, err := domain.SanitizeFilename(".."); err == nil {
		t.Error("'..' accepted as a filename")
	}
}
