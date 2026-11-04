package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/media/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

func TestSanitizeFilename(t *testing.T) {
	tests := []struct{ in, want string }{
		{"photo.jpg", "photo.jpg"},
		{"../../etc/passwd", "passwd"},
		{`C:\Users\x\evil.png`, "evil.png"},
		{"  spaced.txt  ", "spaced.txt"},
		{"a\x00b\r\n.png", "ab.png"},
		{`say "hi".png`, "say hi.png"},
	}
	for _, tc := range tests {
		got, err := domain.SanitizeFilename(tc.in)
		if err != nil || got != tc.want {
			t.Errorf("SanitizeFilename(%q) = %q, %v; want %q", tc.in, got, err, tc.want)
		}
	}
	for _, bad := range []string{"", "   ", ".", "..", "/", strings.Repeat("é", domain.MaxFilenameLength+1)} {
		if _, err := domain.SanitizeFilename(bad); sharederrors.KindOf(err) != sharederrors.KindValidation {
			t.Errorf("SanitizeFilename(%.12q) kind = %v, want validation", bad, sharederrors.KindOf(err))
		}
	}
}

func TestNormalizeContentType(t *testing.T) {
	if got, err := domain.NormalizeContentType("Image/PNG; charset=binary"); err != nil || got != "image/png" {
		t.Errorf("got %q, %v", got, err)
	}
	if _, err := domain.NormalizeContentType("not a media type"); err == nil {
		t.Error("malformed content type must be rejected")
	}
}

func TestSniffMatches(t *testing.T) {
	tests := []struct {
		declared, sniffed string
		want              bool
	}{
		{"image/png", "image/png", true},
		{"image/png", "text/html; charset=utf-8", false}, // HTML disguised as an image
		{"image/jpeg", "image/png", false},
		{"video/quicktime", "video/mp4", true},
		{"audio/wav", "audio/wave", true},
		{"audio/ogg", "application/ogg", true},
		{"application/pdf", "application/pdf", true},
		{"application/pdf", "application/octet-stream", false},
		{"text/plain", "text/plain; charset=utf-8", true},
		{"image/svg+xml", "image/svg+xml", false}, // not on the allow-list
	}
	for _, tc := range tests {
		if got := domain.SniffMatches(tc.declared, tc.sniffed); got != tc.want {
			t.Errorf("SniffMatches(%q, %q) = %v, want %v", tc.declared, tc.sniffed, got, tc.want)
		}
	}
}

func TestNewUpload(t *testing.T) {
	limits := domain.Limits{MaxImageBytes: 1 << 20, MaxVideoBytes: 10 << 20, MaxAudioBytes: 5 << 20, MaxDocumentBytes: 2 << 20}
	owner, id, now := ids.New(), ids.New(), time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	good := strings.Repeat("A", 64)

	m, err := domain.NewUpload(id, owner, "../cat.PNG", "image/png", 1024, good, nil, limits, now)
	if err != nil {
		t.Fatalf("valid upload: %v", err)
	}
	if m.Kind != domain.KindImage || m.Status != domain.StatusPendingUpload || m.Filename != "cat.PNG" || m.SHA256 != strings.ToLower(good) {
		t.Errorf("unexpected record: %+v", m)
	}
	if want := domain.ObjectKey(owner, id, "original"); m.ObjectKey != want || strings.Contains(m.ObjectKey, "cat") {
		t.Errorf("object key %q must be server-chosen (%q), never derived from the filename", m.ObjectKey, want)
	}

	bad := map[string]func() error{
		"svg is not allowed": func() error {
			_, err := domain.NewUpload(id, owner, "a.svg", "image/svg+xml", 10, "", nil, limits, now)
			return err
		},
		"zero size": func() error {
			_, err := domain.NewUpload(id, owner, "a.png", "image/png", 0, "", nil, limits, now)
			return err
		},
		"over the per-kind limit": func() error {
			_, err := domain.NewUpload(id, owner, "a.png", "image/png", limits.MaxImageBytes+1, "", nil, limits, now)
			return err
		},
		"bad sha256": func() error {
			_, err := domain.NewUpload(id, owner, "a.png", "image/png", 10, "xyz", nil, limits, now)
			return err
		},
		"empty filename": func() error {
			_, err := domain.NewUpload(id, owner, "..", "image/png", 10, "", nil, limits, now)
			return err
		},
	}
	for name, run := range bad {
		if kind := sharederrors.KindOf(run()); kind != sharederrors.KindValidation {
			t.Errorf("%s: kind = %v, want validation", name, kind)
		}
	}
}
