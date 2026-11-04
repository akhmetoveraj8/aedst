package processing

import (
	"bytes"
	"context"
	"encoding/json"
	"fmt"
	"image"
	_ "image/jpeg" // registers the JPEG decoder for image.DecodeConfig
	"os"
	"os/exec"
	"slices"
	"strconv"
	"strings"
	"time"
)

// FFmpeg runs ffprobe/ffmpeg as bounded subprocesses. Both paths must be set
// (AEDST_MEDIA_FFMPEG_PATH / AEDST_MEDIA_FFPROBE_PATH); the zero value is
// disabled and video/audio items become READY without poster or duration.
type FFmpeg struct {
	FFmpegPath  string
	FFprobePath string
	Timeout     time.Duration
}

// Enabled reports whether both binaries are configured.
func (f FFmpeg) Enabled() bool { return f.FFmpegPath != "" && f.FFprobePath != "" }

// Probe is what ffprobe reports about a media file.
type Probe struct {
	DurationMs int64
	Width      int
	Height     int
}

type ffprobeOutput struct {
	Format struct {
		FormatName string `json:"format_name"`
		Duration   string `json:"duration"`
	} `json:"format"`
	Streams []ffprobeStream `json:"streams"`
}

type ffprobeStream struct {
	CodecType string `json:"codec_type"`
	Width     int    `json:"width"`
	Height    int    `json:"height"`
}

func (f FFmpeg) run(ctx context.Context, bin string, args ...string) ([]byte, error) {
	ctx, cancel := context.WithTimeout(ctx, f.Timeout)
	defer cancel()
	// args are built by this package from a server-chosen temp path; no user
	// input reaches the command line.
	cmd := exec.CommandContext(ctx, bin, args...) //nolint:gosec // fixed binary from config, controlled args
	var stdout, stderr bytes.Buffer
	cmd.Stdout, cmd.Stderr = &stdout, &stderr
	if err := cmd.Run(); err != nil {
		if ctx.Err() != nil {
			return nil, fmt.Errorf("media: %s timed out after %s", bin, f.Timeout)
		}
		msg := stderr.String()
		if len(msg) > 300 {
			msg = msg[len(msg)-300:]
		}
		return nil, fmt.Errorf("%w: %s: %w: %s", ErrUnprocessable, bin, err, msg)
	}
	return stdout.Bytes(), nil
}

// Probe reads duration and the first video stream's dimensions of a file
// declared as contentType. It fails with ErrUnprocessable unless ffprobe,
// pinned to the declared container's demuxer, reports that same container
// and at least one stream of the declared kind (video or audio).
func (f FFmpeg) Probe(ctx context.Context, path, contentType string) (Probe, error) {
	demuxer, err := demuxerFor(contentType)
	if err != nil {
		return Probe{}, err
	}
	out, err := f.run(ctx, f.FFprobePath, probeArgs(path, demuxer)...)
	if err != nil {
		return Probe{}, err
	}
	var parsed ffprobeOutput
	if err := json.Unmarshal(out, &parsed); err != nil {
		return Probe{}, fmt.Errorf("%w: ffprobe output: %w", ErrUnprocessable, err)
	}
	if !formatMatches(parsed.Format.FormatName, demuxer) {
		return Probe{}, fmt.Errorf("%w: ffprobe reports container %q, declared %s", ErrUnprocessable, parsed.Format.FormatName, contentType)
	}
	want, _, _ := strings.Cut(contentType, "/") // "video" or "audio"
	if !slices.ContainsFunc(parsed.Streams, func(s ffprobeStream) bool { return s.CodecType == want }) {
		return Probe{}, fmt.Errorf("%w: no %s stream in a file declared %s", ErrUnprocessable, want, contentType)
	}
	var p Probe
	if secs, err := strconv.ParseFloat(parsed.Format.Duration, 64); err == nil && secs > 0 {
		p.DurationMs = int64(secs * 1000)
	}
	for _, s := range parsed.Streams {
		if s.CodecType == "video" {
			p.Width, p.Height = s.Width, s.Height
			break
		}
	}
	return p, nil
}

// Poster extracts one frame (at 1s, or the middle of a shorter clip) of a file
// declared as contentType (call Probe first: it verifies the container) and
// returns it as a single JPEG variant. Thumbnails and other sizes of the
// poster are produced on demand by imgproxy, not pre-generated.
func (f FFmpeg) Poster(ctx context.Context, path, contentType string, durationMs int64) ([]Encoded, error) {
	demuxer, err := demuxerFor(contentType)
	if err != nil {
		return nil, err
	}
	at := 1.0
	if durationMs > 0 && durationMs < 2000 {
		at = float64(durationMs) / 2000
	}
	out, err := os.CreateTemp("", "aedst-poster-*.jpg")
	if err != nil {
		return nil, fmt.Errorf("media: temp: %w", err)
	}
	outPath := out.Name()
	_ = out.Close()
	defer func() { _ = os.Remove(outPath) }()

	if _, err := f.run(ctx, f.FFmpegPath, posterArgs(path, demuxer, at, outPath)...); err != nil {
		return nil, err
	}
	data, err := os.ReadFile(outPath) //nolint:gosec // G304: outPath is a file this process created in its own temp dir
	if err != nil {
		return nil, fmt.Errorf("media: read poster: %w", err)
	}
	cfg, _, err := image.DecodeConfig(bytes.NewReader(data))
	if err != nil {
		return nil, fmt.Errorf("%w: poster: %w", ErrUnprocessable, err)
	}
	return []Encoded{
		{Name: "poster", ContentType: "image/jpeg", Ext: "jpg", Width: cfg.Width, Height: cfg.Height, Data: data},
	}, nil
}
