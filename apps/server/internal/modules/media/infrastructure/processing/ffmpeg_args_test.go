package processing

import (
	"context"
	"errors"
	"slices"
	"testing"
)

// before reports whether every flag in flags appears in args ahead of the
// first input (ffmpeg input options only apply to the input that follows them).
func before(args []string, input string, flags ...string) bool {
	in := slices.Index(args, input)
	for _, f := range flags {
		if i := slices.Index(args, f); i < 0 || in < 0 || i > in {
			return false
		}
	}
	return true
}

func TestProbeArgs_PinDemuxerAndFileProtocol(t *testing.T) {
	args := probeArgs("/tmp/aedst-1.bin", "mov")
	if !slices.Equal(args[2:6], []string{"-protocol_whitelist", "file", "-f", "mov"}) {
		t.Errorf("args = %q, want -protocol_whitelist file -f mov before the input", args)
	}
	if args[len(args)-1] != "file:/tmp/aedst-1.bin" {
		t.Errorf("input = %q, want the file: protocol prefix", args[len(args)-1])
	}
}

func TestPosterArgs_PinDemuxerAndFileProtocol(t *testing.T) {
	args := posterArgs("/tmp/in.bin", "matroska", 1, "/tmp/out.jpg")
	if !before(args, "-i", "-protocol_whitelist", "-f") {
		t.Fatalf("args = %q: input options must precede -i", args)
	}
	i := slices.Index(args, "-i")
	if args[i+1] != "file:/tmp/in.bin" || args[slices.Index(args, "-f")+1] != "matroska" ||
		args[slices.Index(args, "-protocol_whitelist")+1] != "file" || args[len(args)-1] != "file:/tmp/out.jpg" {
		t.Errorf("args = %q", args)
	}
}

func TestDemuxerFor(t *testing.T) {
	for ct, want := range map[string]string{
		"video/mp4": "mov", "video/quicktime": "mov", "audio/mp4": "mov",
		"video/webm": "matroska", "audio/webm": "matroska",
		"audio/mpeg": "mp3", "audio/ogg": "ogg", "audio/wav": "wav",
	} {
		if got, err := demuxerFor(ct); err != nil || got != want {
			t.Errorf("demuxerFor(%q) = %q, %v; want %q", ct, got, err, want)
		}
	}
	for _, ct := range []string{"application/vnd.apple.mpegurl", "image/png", "application/octet-stream", ""} {
		if _, err := demuxerFor(ct); !errors.Is(err, ErrUnprocessable) {
			t.Errorf("demuxerFor(%q) err = %v, want ErrUnprocessable", ct, err)
		}
	}
}

func TestFormatMatches(t *testing.T) {
	cases := []struct {
		formatName, demuxer string
		want                bool
	}{
		{"mov,mp4,m4a,3gp,3g2,mj2", "mov", true},
		{"matroska,webm", "matroska", true},
		{"mp3", "mp3", true},
		{"hls", "mov", false},
		{"concat", "mov", false},
		{"mp3", "mov", false},
		{"", "mov", false},
		{"movx", "mov", false},
	}
	for _, c := range cases {
		if got := formatMatches(c.formatName, c.demuxer); got != c.want {
			t.Errorf("formatMatches(%q, %q) = %v, want %v", c.formatName, c.demuxer, got, c.want)
		}
	}
}

// An unmapped type never reaches a subprocess: there is no demuxer to pin.
func TestFFmpeg_UnmappedTypeIsUnprocessableWithoutRunning(t *testing.T) {
	f := FFmpeg{FFmpegPath: "/nonexistent/ffmpeg", FFprobePath: "/nonexistent/ffprobe"}
	if _, err := f.Probe(context.Background(), "/tmp/x", "application/x-mpegurl"); !errors.Is(err, ErrUnprocessable) {
		t.Errorf("Probe err = %v, want ErrUnprocessable", err)
	}
	if _, err := f.Poster(context.Background(), "/tmp/x", "text/plain", 0); !errors.Is(err, ErrUnprocessable) {
		t.Errorf("Poster err = %v, want ErrUnprocessable", err)
	}
}
