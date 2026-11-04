// Package processing prepares a completed upload for storage: images are
// validated and sanitized through libvips (govips, build tag "vips"), video
// and audio are probed with ffprobe/ffmpeg when configured.
//
// Division of labour (ADR-0015): this package only sanitizes the ORIGINAL
// (validate, pixel limit, auto-orient, strip EXIF/GPS, canonical encoding).
// Generic size/format variants (64/256/400/800x600/1080x1350, WebP/AVIF) are
// NOT pre-generated here: imgproxy produces them on demand at delivery time.
package processing

import (
	"context"
	"errors"
)

// ErrUnprocessable marks input that will never process (corrupt, too large,
// unsupported): the item is marked FAILED and the job is not retried.
var ErrUnprocessable = errors.New("media: unprocessable input")

// ErrImagingUnavailable means this binary was built without libvips
// (-tags vips). It is deliberately distinct from ErrUnprocessable: the upload
// is fine, the deployment is wrong, so the job is retried rather than the
// user's file being marked FAILED.
var ErrImagingUnavailable = errors.New("media: built without libvips (-tags vips)")

// Encoded is an encoded file ready to store (a video poster frame).
type Encoded struct {
	Name        string
	ContentType string
	Ext         string
	Width       int
	Height      int
	Data        []byte
}

// Sanitized is the result of sanitizing an uploaded image.
type Sanitized struct {
	// Width and Height are the display dimensions after auto-orientation.
	Width, Height int
	// Changed reports whether Data replaces the uploaded bytes. False means
	// the upload was validated and is stored unmodified (animated GIF).
	Changed bool
	// ContentType and Data are set when Changed; the type is always the
	// uploaded type (JPEG stays JPEG, PNG stays PNG, WebP stays WebP).
	ContentType string
	Data        []byte
}

// ImageProcessor validates and sanitizes one uploaded image. The worker
// depends on this interface so unit tests can use a fake; the real
// implementation is govips/libvips (images_vips.go).
type ImageProcessor interface {
	// Sanitize reads the image header first and refuses anything over
	// maxPixels before a full decode (decompression-bomb guard), then
	// auto-orients and strips all metadata (EXIF, GPS, XMP, IPTC).
	Sanitize(ctx context.Context, data []byte, declaredType string, maxPixels int64) (Sanitized, error)
}
