// Package jobs holds the media module's River job kinds: processing (on the
// dedicated "media" queue, so a worker deployment can run it apart from the
// API) and object cleanup.
package jobs

import (
	"github.com/riverqueue/river"

	platformjobs "github.com/aedst/server/internal/platform/jobs"
)

// ProcessArgs processes one completed upload.
type ProcessArgs struct {
	MediaID string `json:"media_id" river:"unique"`
}

func (ProcessArgs) Kind() string { return "media.process" }

func (ProcessArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{Queue: platformjobs.QueueMedia, MaxAttempts: 5, UniqueOpts: river.UniqueOpts{ByArgs: true}}
}

// DeleteObjectsArgs removes stored objects after their rows are gone.
type DeleteObjectsArgs struct {
	Keys []string `json:"keys"`
}

func (DeleteObjectsArgs) Kind() string { return "media.delete_objects" }

func (DeleteObjectsArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: 10}
}
