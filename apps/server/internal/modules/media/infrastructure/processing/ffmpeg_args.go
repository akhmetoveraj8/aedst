package processing

import (
	"fmt"
	"slices"
	"strconv"
	"strings"
)

// Uploads are untrusted input to ffmpeg/ffprobe, whose defaults would probe
// any of hundreds of formats and follow references inside them: an HLS or
// concat playlist disguised as a video makes ffmpeg fetch arbitrary URLs
// (SSRF) or read local files into the output. So every invocation:
//
//   - pins the demuxer of the declared container (-f), so probing cannot pick
//     a playlist, concat or image-sequence demuxer for crafted bytes;
//   - allows only the file protocol (-protocol_whitelist file), so no format
//     can open a network or other protocol even if one is reached;
//   - names the input as "file:<path>", so the path is never parsed as a
//     protocol or an option.

// demuxers maps each allow-listed video/audio type to the ffmpeg demuxer that
// reads it (the name `ffmpeg -demuxers` lists; ffprobe reports the demuxer's
// full comma-separated name list as format_name, e.g. "mov,mp4,m4a,3gp,3g2,mj2").
var demuxers = map[string]string{
	"video/mp4":       "mov",
	"video/quicktime": "mov",
	"audio/mp4":       "mov",
	"video/webm":      "matroska",
	"audio/webm":      "matroska",
	"audio/mpeg":      "mp3",
	"audio/ogg":       "ogg",
	"audio/wav":       "wav",
}

func demuxerFor(contentType string) (string, error) {
	d, ok := demuxers[contentType]
	if !ok {
		return "", fmt.Errorf("%w: no ffmpeg demuxer for %q", ErrUnprocessable, contentType)
	}
	return d, nil
}

// formatMatches reports whether ffprobe's format_name (a comma-separated list
// of the demuxer's names) is the pinned demuxer.
func formatMatches(formatName, demuxer string) bool {
	return slices.Contains(strings.Split(formatName, ","), demuxer)
}

// inputArgs are the options that must precede every untrusted -i / input.
func inputArgs(demuxer string) []string {
	return []string{"-protocol_whitelist", "file", "-f", demuxer}
}

func probeArgs(path, demuxer string) []string {
	args := []string{"-v", "error"}
	args = append(args, inputArgs(demuxer)...)
	return append(args, "-print_format", "json", "-show_format", "-show_streams", "file:"+path)
}

func posterArgs(path, demuxer string, at float64, outPath string) []string {
	args := []string{"-nostdin", "-v", "error", "-y", "-ss", strconv.FormatFloat(at, 'f', 3, 64)}
	args = append(args, inputArgs(demuxer)...)
	return append(args, "-i", "file:"+path,
		"-frames:v", "1", "-vf", "scale='min(1280,iw)':-2", "-q:v", "3", "file:"+outPath)
}
