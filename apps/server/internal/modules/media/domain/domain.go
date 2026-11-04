// Package domain holds the media module's model: an uploaded file, its
// processing state machine and the per-kind upload policy.
package domain

import (
	"mime"
	"path"
	"strings"
	"time"
	"unicode"
	"unicode/utf8"

	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

type Kind string

const (
	KindImage    Kind = "image"
	KindVideo    Kind = "video"
	KindAudio    Kind = "audio"
	KindDocument Kind = "document"
)

type Status string

const (
	StatusPendingUpload Status = "pending_upload"
	StatusProcessing    Status = "processing"
	StatusReady         Status = "ready"
	StatusFailed        Status = "failed"
)

type VariantKind string

const (
	VariantPoster VariantKind = "poster"

	// Derived (imgproxy) delivery renditions: never stored, never in the
	// variants table; Links builds their signed URLs on read (ADR-0015).
	VariantThumb64        VariantKind = "thumb_64"
	VariantAvatar256      VariantKind = "avatar_256"
	VariantCard400        VariantKind = "card_400"
	VariantFeed800x600    VariantKind = "feed_800x600"
	VariantStory1080x1350 VariantKind = "story_1080x1350"
)

// MaxFilenameLength mirrors media.proto.
const MaxFilenameLength = 255

// allowed is the upload allow-list: declared content type -> kind. Anything
// else is rejected before an upload URL is issued (no SVG/HTML: they execute
// script when opened from a storage origin).
var allowed = map[string]Kind{
	"image/jpeg": KindImage,
	"image/png":  KindImage,
	"image/gif":  KindImage,
	"image/webp": KindImage,

	"video/mp4":       KindVideo,
	"video/webm":      KindVideo,
	"video/quicktime": KindVideo,

	"audio/mpeg": KindAudio,
	"audio/mp4":  KindAudio,
	"audio/ogg":  KindAudio,
	"audio/wav":  KindAudio,
	"audio/webm": KindAudio,

	"application/pdf": KindDocument,
	"text/plain":      KindDocument,
}

// Limits bounds upload sizes per kind (AEDST_MEDIA_MAX_*_BYTES).
type Limits struct {
	MaxImageBytes    int64
	MaxVideoBytes    int64
	MaxAudioBytes    int64
	MaxDocumentBytes int64
}

func (l Limits) maxFor(k Kind) int64 {
	switch k {
	case KindImage:
		return l.MaxImageBytes
	case KindVideo:
		return l.MaxVideoBytes
	case KindAudio:
		return l.MaxAudioBytes
	default:
		return l.MaxDocumentBytes
	}
}

// Variant is a derived rendition.
type Variant struct {
	Kind        VariantKind
	ObjectKey   string
	ContentType string
	Width       int
	Height      int
	SizeBytes   int64
}

// Media is one uploaded file.
type Media struct {
	ID            ids.ID
	OwnerID       ids.ID
	Kind          Kind
	Status        Status
	Filename      string
	ContentType   string
	DeclaredSize  int64
	SizeBytes     int64
	Width         int
	Height        int
	DurationMs    int64
	ObjectKey     string
	SHA256        string
	TaskID        *ids.ID
	FailureReason string
	Version       int
	CreatedAt     time.Time
	UpdatedAt     time.Time
	Variants      []Variant
}

// NewUpload validates an upload request against the allow-list and limits
// and builds the PENDING_UPLOAD record. The object key is server-chosen
// (never derived from the client's filename).
func NewUpload(id, owner ids.ID, filename, contentType string, size int64, sha256Hex string, taskID *ids.ID, limits Limits, now time.Time) (Media, error) {
	ct, err := NormalizeContentType(contentType)
	if err != nil {
		return Media{}, err
	}
	kind, ok := allowed[ct]
	if !ok {
		return Media{}, sharederrors.Validation("media.content_type", "content type "+ct+" is not allowed")
	}
	if size <= 0 {
		return Media{}, sharederrors.Validation("media.size", "size must be positive")
	}
	if max := limits.maxFor(kind); max > 0 && size > max {
		return Media{}, sharederrors.Validation("media.size", "file is too large for its kind")
	}
	name, err := SanitizeFilename(filename)
	if err != nil {
		return Media{}, err
	}
	sha256Hex = strings.ToLower(sha256Hex)
	if sha256Hex != "" && !isHex(sha256Hex, 64) {
		return Media{}, sharederrors.Validation("media.sha256", "sha256 must be 64 hex characters")
	}
	return Media{
		ID: id, OwnerID: owner, Kind: kind, Status: StatusPendingUpload,
		Filename: name, ContentType: ct, DeclaredSize: size, SHA256: sha256Hex,
		ObjectKey: ObjectKey(owner, id, "original"), TaskID: taskID,
		Version: 1, CreatedAt: now, UpdatedAt: now,
	}, nil
}

// ObjectKey is the storage key of one of a media item's objects.
func ObjectKey(owner, id ids.ID, name string) string {
	return "media/" + owner.String() + "/" + id.String() + "/" + name
}

// NormalizeContentType lower-cases and strips parameters.
func NormalizeContentType(ct string) (string, error) {
	mt, _, err := mime.ParseMediaType(ct)
	if err != nil {
		return "", sharederrors.Validation("media.content_type", "malformed content type")
	}
	return mt, nil
}

// SanitizeFilename keeps a display name safe for Content-Disposition and UIs:
// base name only, no control characters, bounded length.
func SanitizeFilename(name string) (string, error) {
	name = path.Base(strings.ReplaceAll(name, "\\", "/"))
	name = strings.Map(func(r rune) rune {
		if unicode.IsControl(r) || r == '"' || r == '\\' {
			return -1
		}
		return r
	}, name)
	name = strings.TrimSpace(name)
	if name == "" || name == "." || name == "/" || name == ".." {
		return "", sharederrors.Validation("media.filename", "filename is required")
	}
	if utf8.RuneCountInString(name) > MaxFilenameLength {
		return "", sharederrors.Validation("media.filename", "filename is too long")
	}
	return name, nil
}

// SniffMatches reports whether the content type sniffed from the object's
// first bytes (http.DetectContentType) is consistent with what the client
// declared. Sniffing recognises fewer formats than the allow-list, so the
// check is by family where the sniffer is coarse.
func SniffMatches(declared, sniffed string) bool {
	sniffed, _ = NormalizeContentType(sniffed)
	switch declared {
	case "image/jpeg", "image/png", "image/gif", "image/webp", "application/pdf", "video/webm", "audio/wav":
		if declared == "audio/wav" {
			return sniffed == "audio/wave" || sniffed == "audio/wav"
		}
		return sniffed == declared
	case "video/mp4", "video/quicktime", "audio/mp4":
		// ISO BMFF: the sniffer reports video/mp4 for every ftyp brand.
		return sniffed == "video/mp4" || sniffed == "application/octet-stream"
	case "audio/mpeg":
		return sniffed == "audio/mpeg" || sniffed == "application/octet-stream"
	case "audio/ogg":
		return sniffed == "application/ogg" || sniffed == "audio/ogg"
	case "audio/webm":
		return sniffed == "video/webm" || sniffed == "audio/webm"
	case "text/plain":
		return sniffed == "text/plain"
	}
	return false
}

func isHex(s string, n int) bool {
	if len(s) != n {
		return false
	}
	for _, c := range s {
		if (c < '0' || c > '9') && (c < 'a' || c > 'f') {
			return false
		}
	}
	return true
}
