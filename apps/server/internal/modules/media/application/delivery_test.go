package application_test

import (
	"context"
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/media/application"
	"github.com/aedst/server/internal/modules/media/domain"
	"github.com/aedst/server/internal/platform/imgproxy"
	"github.com/aedst/server/internal/platform/storage"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

func deliveryService(t *testing.T, enabled bool) *application.Service {
	t.Helper()
	cfg := application.Config{DownloadURLTTL: time.Hour}
	if enabled {
		s, err := imgproxy.New(imgproxy.Config{BaseURL: "https://img.example.com", Bucket: "aedst", KeyHex: "00ff", SaltHex: "00ff"})
		if err != nil {
			t.Fatal(err)
		}
		cfg.Delivery = s
	}
	return application.NewService(newRepo(), storage.NewMemory(), nil, sharedtime.Fixed{At: time.Now()}, cfg, true)
}

func TestLinks_DerivedVariantsAreImgproxyURLsOfTheOriginal(t *testing.T) {
	m := domain.Media{
		ID: ids.New(), OwnerID: ids.New(), Kind: domain.KindImage, Status: domain.StatusReady,
		Filename: "a.jpg", ObjectKey: "media/o/i/original", Width: 2000, Height: 1000,
	}
	links, err := deliveryService(t, true).Links(context.Background(), m)
	if err != nil {
		t.Fatal(err)
	}
	if len(links.Derived) != 5 {
		t.Fatalf("derived = %d, want 5 presets", len(links.Derived))
	}
	byKind := map[domain.VariantKind]application.DerivedVariant{}
	for _, d := range links.Derived {
		byKind[d.Kind] = d
		if !strings.HasPrefix(d.URL, "https://img.example.com/") || !strings.HasSuffix(d.URL, "/plain/s3://aedst/media/o/i/original") {
			t.Errorf("%s url = %s", d.Kind, d.URL)
		}
	}
	if c := byKind[domain.VariantCard400]; c.Width != 400 || c.Height != 200 {
		t.Errorf("card_400 = %dx%d, want 400x200 (proportional)", c.Width, c.Height)
	}
	if f := byKind[domain.VariantFeed800x600]; f.Width != 800 || f.Height != 600 {
		t.Errorf("feed = %dx%d", f.Width, f.Height)
	}
}

func TestLinks_NoDerivedWhenDisabledOrNotAnImage(t *testing.T) {
	m := domain.Media{ID: ids.New(), Kind: domain.KindImage, Status: domain.StatusReady, ObjectKey: "k"}
	if links, _ := deliveryService(t, false).Links(context.Background(), m); len(links.Derived) != 0 {
		t.Error("imgproxy disabled: no derived variants")
	}
	m.Kind = domain.KindDocument
	if links, _ := deliveryService(t, true).Links(context.Background(), m); len(links.Derived) != 0 {
		t.Error("documents have no derived variants")
	}
}

func TestLinks_VideoDerivesFromStoredPoster(t *testing.T) {
	m := domain.Media{
		ID: ids.New(), Kind: domain.KindVideo, Status: domain.StatusReady, ObjectKey: "v",
		Variants: []domain.Variant{{Kind: domain.VariantPoster, ObjectKey: "media/o/i/poster.jpg", Width: 1280, Height: 720}},
	}
	links, err := deliveryService(t, true).Links(context.Background(), m)
	if err != nil || len(links.Derived) != 5 || !strings.HasSuffix(links.Derived[0].URL, "/poster.jpg") {
		t.Fatalf("derived = %+v, %v", links.Derived, err)
	}
}
