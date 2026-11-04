//go:build !vips

package processing_test

import (
	"errors"
	"testing"

	"github.com/aedst/server/internal/modules/media/infrastructure/processing"
)

func TestWorker_MissingLibvipsRetriesAndDoesNotFailTheUpload(t *testing.T) {
	// Config.Images unset: the stub of builds without -tags vips is used.
	w, store, _, id, _ := newImageFixture(t, nil)
	err := run(t, w, id)
	if !errors.Is(err, processing.ErrImagingUnavailable) || errors.Is(err, processing.ErrUnprocessable) {
		t.Fatalf("err = %v, want ErrImagingUnavailable (distinct from ErrUnprocessable)", err)
	}
	if store.failed != "" {
		t.Errorf("a deployment problem must not mark the user's file FAILED on attempt 1: %q", store.failed)
	}
}
