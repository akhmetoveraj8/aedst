//go:build vips

// Needs libvips and cgo: run with `go test -tags vips ./internal/modules/media/...`.
// Test images are generated here at run time; there are no binary fixtures.

package processing_test

import (
	"bytes"
	"context"
	"errors"
	"image"
	"image/color"
	"image/gif"
	"image/jpeg"
	"image/png"
	"os"
	"testing"

	"github.com/aedst/server/internal/modules/media/infrastructure/processing"
)

func TestMain(m *testing.M) {
	stop, err := processing.StartImaging()
	if err != nil {
		panic(err)
	}
	code := m.Run()
	stop()
	os.Exit(code)
}

func gradient(w, h int, alpha bool) *image.NRGBA {
	img := image.NewNRGBA(image.Rect(0, 0, w, h))
	for y := range h {
		for x := range w {
			a := uint8(255)
			if alpha && x == 0 {
				a = 0
			}
			img.SetNRGBA(x, y, color.NRGBA{R: uint8(x * 5), G: uint8(y * 5), B: 100, A: a})
		}
	}
	return img
}

// jpegWithExif inserts an APP1/Exif segment (big-endian TIFF, one IFD0 entry:
// Orientation) right after SOI, plus a recognisable marker string standing in
// for GPS data, so tests can prove it is gone.
func jpegWithExif(t *testing.T, w, h, orientation int) []byte {
	t.Helper()
	var plain bytes.Buffer
	if err := jpeg.Encode(&plain, gradient(w, h, false), &jpeg.Options{Quality: 90}); err != nil {
		t.Fatal(err)
	}
	tiff := []byte{
		'M', 'M', 0, 42, 0, 0, 0, 8, // header, IFD0 at offset 8
		0, 1, // one entry
		0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, byte(orientation), 0, 0, // Orientation, SHORT, count 1
		0, 0, 0, 0, // next IFD
	}
	payload := append([]byte("Exif\x00\x00"), tiff...)
	payload = append(payload, []byte("GPS-MARKER-48.8566N")...)
	segLen := len(payload) + 2
	seg := append([]byte{0xFF, 0xE1, byte(segLen >> 8), byte(segLen)}, payload...)
	b := plain.Bytes()
	return append(append(append([]byte{}, b[:2]...), seg...), b[2:]...)
}

func TestSanitize_JPEGOrientsAndStripsMetadata(t *testing.T) {
	src := jpegWithExif(t, 40, 20, 6) // 6 = rotate 90 CW
	res, err := processing.NewImageProcessor().Sanitize(context.Background(), src, "image/jpeg", 50_000_000)
	if err != nil {
		t.Fatal(err)
	}
	if !res.Changed || res.ContentType != "image/jpeg" {
		t.Fatalf("res = changed %v type %q", res.Changed, res.ContentType)
	}
	if res.Width != 20 || res.Height != 40 {
		t.Errorf("dimensions = %dx%d, want 20x40 after auto-orient", res.Width, res.Height)
	}
	if bytes.Contains(res.Data, []byte("GPS-MARKER")) || bytes.Contains(res.Data, []byte("Exif")) {
		t.Error("EXIF/GPS survived sanitization")
	}
	cfg, err := jpeg.DecodeConfig(bytes.NewReader(res.Data))
	if err != nil || cfg.Width != 20 || cfg.Height != 40 {
		t.Errorf("stored pixels = %+v, %v; want 20x40 with no orientation tag", cfg, err)
	}
}

func TestSanitize_PNGKeepsAlpha(t *testing.T) {
	var buf bytes.Buffer
	_ = png.Encode(&buf, gradient(32, 16, true))
	res, err := processing.NewImageProcessor().Sanitize(context.Background(), buf.Bytes(), "image/png", 50_000_000)
	if err != nil || !res.Changed || res.ContentType != "image/png" {
		t.Fatalf("res = %+v, %v", res, err)
	}
	img, err := png.Decode(bytes.NewReader(res.Data))
	if err != nil {
		t.Fatal(err)
	}
	if _, _, _, a := img.At(0, 0).RGBA(); a != 0 {
		t.Errorf("alpha lost: %d", a)
	}
}

func TestSanitize_GIFIsValidatedAndLeftAlone(t *testing.T) {
	var buf bytes.Buffer
	_ = gif.Encode(&buf, gradient(16, 16, false), nil)
	res, err := processing.NewImageProcessor().Sanitize(context.Background(), buf.Bytes(), "image/gif", 50_000_000)
	if err != nil || res.Changed || res.Width != 16 || res.Height != 16 {
		t.Fatalf("res = %+v, %v", res, err)
	}
}

func TestSanitize_RefusesBombsGarbageAndTypeMismatch(t *testing.T) {
	p := processing.NewImageProcessor()
	src := jpegWithExif(t, 100, 100, 1)
	cases := map[string]struct {
		data []byte
		ct   string
		max  int64
	}{
		"over pixel limit": {src, "image/jpeg", 5_000},
		"garbage":          {[]byte("not an image"), "image/png", 1e9},
		"type mismatch":    {src, "image/png", 1e9},
		"unsupported type": {src, "image/bmp", 1e9},
	}
	for name, c := range cases {
		if _, err := p.Sanitize(context.Background(), c.data, c.ct, c.max); !errors.Is(err, processing.ErrUnprocessable) {
			t.Errorf("%s: err = %v, want ErrUnprocessable", name, err)
		}
	}
}
