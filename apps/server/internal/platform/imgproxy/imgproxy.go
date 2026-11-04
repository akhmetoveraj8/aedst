// Package imgproxy builds signed imgproxy delivery URLs (ADR-0015).
//
// imgproxy resizes and re-encodes on demand (libvips inside imgproxy), reading
// the sanitized original straight from the S3-compatible bucket. The server
// never resizes: it only signs "preset + source" paths. Presets are defined in
// imgproxy's own configuration (IMGPROXY_PRESETS, see PresetsEnv) and every
// URL is HMAC-signed, so a client cannot turn a URL into an arbitrary
// transformation (IMGPROXY_ONLY_PRESETS is NOT used: it forbids the exp
// option). Output format (WebP/AVIF/JPEG) is negotiated by imgproxy from the
// Accept header because the URL carries no extension.
package imgproxy

import (
	"crypto/hmac"
	"crypto/sha256"
	"encoding/base64"
	"encoding/hex"
	"errors"
	"fmt"
	"net/url"
	"strconv"
	"strings"
	"time"
)

// Preset is one named delivery size. Name is the key in IMGPROXY_PRESETS.
type Preset struct {
	Name          string
	Width, Height int // target box; Height 0 = proportional to the source
}

// The presets AEDST clients use. Keep Presets in sync with PresetsEnv.
var (
	Thumb64        = Preset{Name: "thumb_64", Width: 64, Height: 64}
	Avatar256      = Preset{Name: "avatar_256", Width: 256, Height: 256}
	Card400        = Preset{Name: "card_400", Width: 400}
	Feed800x600    = Preset{Name: "feed_800x600", Width: 800, Height: 600}
	Story1080x1350 = Preset{Name: "story_1080x1350", Width: 1080, Height: 1350}
)

// PresetsEnv is the value for imgproxy's IMGPROXY_PRESETS that defines the
// presets above (resize type fill/fit; no enlarging; smart gravity for crops).
// compose and helm use exactly this string.
const PresetsEnv = "thumb_64=resize:fill:64:64/gravity:sm," +
	"avatar_256=resize:fill:256:256/gravity:sm," +
	"card_400=resize:fit:400:0," +
	"feed_800x600=resize:fill:800:600/gravity:sm," +
	"story_1080x1350=resize:fill:1080:1350/gravity:sm"

// Signer signs imgproxy URLs. A nil *Signer is disabled: URL returns "".
type Signer struct {
	baseURL string
	bucket  string
	key     []byte
	salt    []byte
	ttl     time.Duration
	now     func() time.Time
}

// Config configures a Signer.
type Config struct {
	// BaseURL is the public imgproxy/CDN origin, e.g. https://img.example.com.
	BaseURL string
	// Bucket is the object-storage bucket imgproxy reads (s3://bucket/key).
	Bucket string
	// KeyHex and SaltHex are IMGPROXY_KEY / IMGPROXY_SALT (hex-encoded).
	KeyHex, SaltHex string
	// TTL makes URLs expire (imgproxy "exp" option). Expiry is rounded to a
	// TTL boundary so URLs stay identical within a window and CDNs can cache.
	// Zero means URLs do not expire.
	TTL time.Duration
}

// New validates cfg and returns a Signer.
func New(cfg Config) (*Signer, error) {
	u, err := url.Parse(cfg.BaseURL)
	if err != nil || (u.Scheme != "http" && u.Scheme != "https") || u.Host == "" {
		return nil, fmt.Errorf("imgproxy: base URL %q must be an absolute http(s) URL", cfg.BaseURL)
	}
	if cfg.Bucket == "" {
		return nil, errors.New("imgproxy: bucket is required")
	}
	key, err := hex.DecodeString(cfg.KeyHex)
	if err != nil || len(key) == 0 {
		return nil, errors.New("imgproxy: key must be non-empty hex")
	}
	salt, err := hex.DecodeString(cfg.SaltHex)
	if err != nil || len(salt) == 0 {
		return nil, errors.New("imgproxy: salt must be non-empty hex")
	}
	return &Signer{
		baseURL: strings.TrimRight(cfg.BaseURL, "/"), bucket: cfg.Bucket,
		key: key, salt: salt, ttl: cfg.TTL, now: time.Now,
	}, nil
}

// Enabled reports whether URLs can be built.
func (s *Signer) Enabled() bool { return s != nil }

// URL returns the signed URL of objectKey rendered with preset.
func (s *Signer) URL(objectKey string, p Preset) string {
	if s == nil {
		return ""
	}
	var path strings.Builder
	path.WriteString("/preset:" + p.Name)
	if s.ttl > 0 {
		t := int64(s.ttl / time.Second)
		path.WriteString("/exp:" + strconv.FormatInt((s.now().Unix()/t+2)*t, 10))
	}
	path.WriteString("/plain/s3://" + s.bucket + "/" + escapeKey(objectKey))
	return s.baseURL + "/" + s.sign(path.String()) + path.String()
}

// sign is imgproxy's scheme: URL-safe base64 of HMAC-SHA256(key, salt+path).
func (s *Signer) sign(path string) string {
	mac := hmac.New(sha256.New, s.key)
	mac.Write(s.salt)
	mac.Write([]byte(path))
	return base64.RawURLEncoding.EncodeToString(mac.Sum(nil))
}

// escapeKey percent-encodes each path segment of an object key.
func escapeKey(key string) string {
	parts := strings.Split(key, "/")
	for i, p := range parts {
		parts[i] = url.PathEscape(p)
	}
	return strings.Join(parts, "/")
}
