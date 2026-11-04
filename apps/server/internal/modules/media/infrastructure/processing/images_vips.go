//go:build vips

// This file is the real image path (govips over libvips, cgo). It is NOT
// compiled in the default build and was not compiled where it was authored
// (CGO_ENABLED=0, no libvips): the first CI run with -tags vips is its
// acceptance test.

package processing

import (
	"context"
	"fmt"

	"github.com/davidbyttow/govips/v2/vips"
)

// ImagingBuiltIn reports whether libvips support is compiled in.
const ImagingBuiltIn = true

// StartImaging initialises libvips once per process. Call the returned stop
// function on shutdown. libvips cannot be restarted after Shutdown.
func StartImaging() (stop func(), err error) {
	vips.LoggingSettings(nil, vips.LogLevelWarning)
	// One libvips thread per image: parallelism comes from River workers, and
	// -1 selects govips' defaults for the operation cache.
	if err := vips.Startup(&vips.Config{ConcurrencyLevel: 1, MaxCacheFiles: -1, MaxCacheMem: -1, MaxCacheSize: -1}); err != nil {
		return nil, fmt.Errorf("media: start libvips: %w", err)
	}
	return vips.Shutdown, nil
}

type vipsProcessor struct{}

// NewImageProcessor returns the govips-backed processor.
func NewImageProcessor() ImageProcessor { return vipsProcessor{} }

// jpegQuality is the canonical re-encode quality of a sanitized JPEG; imgproxy
// derives every delivery variant from this file.
const (
	jpegQuality = 90
	webpQuality = 90
)

func expectedFormat(contentType string) (vips.ImageType, bool) {
	switch contentType {
	case "image/jpeg":
		return vips.ImageTypeJPEG, true
	case "image/png":
		return vips.ImageTypePNG, true
	case "image/webp":
		return vips.ImageTypeWEBP, true
	case "image/gif":
		return vips.ImageTypeGIF, true
	}
	return vips.ImageTypeUnknown, false
}

func (vipsProcessor) Sanitize(ctx context.Context, data []byte, declaredType string, maxPixels int64) (Sanitized, error) {
	if err := ctx.Err(); err != nil {
		return Sanitized{}, err
	}
	want, ok := expectedFormat(declaredType)
	if !ok {
		return Sanitized{}, fmt.Errorf("%w: unsupported image type %s", ErrUnprocessable, declaredType)
	}

	// Load is lazy: libvips reads the header and decodes pixels on demand, so
	// the dimension check below happens before any full decode. Only the
	// first frame/page is loaded (animated WebP is flattened to it).
	params := vips.NewImportParams()
	params.FailOnError.Set(true)
	params.NumPages.Set(1)
	img, err := vips.LoadImageFromBuffer(data, params)
	if err != nil {
		return Sanitized{}, fmt.Errorf("%w: %w", ErrUnprocessable, err)
	}
	defer img.Close()

	if img.OriginalFormat() != want {
		return Sanitized{}, fmt.Errorf("%w: content does not match declared type %s", ErrUnprocessable, declaredType)
	}
	w, h := img.Width(), img.Height()
	if w <= 0 || h <= 0 || int64(w)*int64(h) > maxPixels {
		return Sanitized{}, fmt.Errorf("%w: image is %dx%d (limit %d pixels)", ErrUnprocessable, w, h, maxPixels)
	}

	if want == vips.ImageTypeGIF || (want == vips.ImageTypeWEBP && img.Pages() > 1) {
		// GIF carries no EXIF/GPS and may be animated, as may WebP;
		// re-encoding would flatten or bloat them. They are validated and
		// stored unmodified; imgproxy serves them (first frame unless
		// animation is enabled there).
		return Sanitized{Width: w, Height: h}, nil
	}

	if err := ctx.Err(); err != nil {
		return Sanitized{}, err
	}
	if err := img.AutoRotate(); err != nil {
		return Sanitized{}, fmt.Errorf("%w: auto-orient: %w", ErrUnprocessable, err)
	}

	var out []byte
	switch want {
	case vips.ImageTypeJPEG:
		p := vips.NewJpegExportParams()
		p.StripMetadata, p.Quality, p.Interlace, p.OptimizeCoding = true, jpegQuality, true, true
		out, _, err = img.ExportJpeg(p)
	case vips.ImageTypePNG:
		p := vips.NewPngExportParams()
		p.StripMetadata, p.Compression = true, 9
		out, _, err = img.ExportPng(p)
	default: // WebP
		p := vips.NewWebpExportParams()
		p.StripMetadata, p.Quality = true, webpQuality
		out, _, err = img.ExportWebp(p)
	}
	if err != nil {
		return Sanitized{}, fmt.Errorf("%w: encode: %w", ErrUnprocessable, err)
	}
	// Dimensions after auto-orientation (a 90 degree EXIF rotation swaps them).
	return Sanitized{Width: img.Width(), Height: img.Height(), Changed: true, ContentType: declaredType, Data: out}, nil
}
