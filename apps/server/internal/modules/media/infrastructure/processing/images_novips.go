//go:build !vips

package processing

import "context"

// ImagingBuiltIn reports whether libvips support is compiled in.
const ImagingBuiltIn = false

// StartImaging is a no-op without libvips; the returned stop function does nothing.
func StartImaging() (stop func(), err error) { return func() {}, nil }

type unavailableProcessor struct{}

// NewImageProcessor returns a processor that fails every image with
// ErrImagingUnavailable. Default builds (no cgo, no libvips) use it so the
// module compiles and its unit tests run with a fake processor.
func NewImageProcessor() ImageProcessor { return unavailableProcessor{} }

func (unavailableProcessor) Sanitize(context.Context, []byte, string, int64) (Sanitized, error) {
	return Sanitized{}, ErrImagingUnavailable
}
