package api

import "time"

// Integration events the media module publishes via platform/events (same
// evolution rules as tasks/api/events.go: fields are only added within a
// version).
const (
	// MediaReadyEventType is published once, when processing finished.
	MediaReadyEventType    = "media.v1.MediaReady"
	MediaReadyEventVersion = 1

	// MediaDeletedEventType is published when an owner deletes a file.
	MediaDeletedEventType    = "media.v1.MediaDeleted"
	MediaDeletedEventVersion = 1
)

// MediaReadyEvent is the payload of MediaReadyEventType.
type MediaReadyEvent struct {
	MediaID     string    `json:"media_id"`
	UserID      string    `json:"user_id"`
	Kind        string    `json:"kind"`
	Filename    string    `json:"filename"`
	ContentType string    `json:"content_type"`
	SizeBytes   int64     `json:"size_bytes"`
	TaskID      string    `json:"task_id,omitempty"`
	ReadyAt     time.Time `json:"ready_at"`
	// Version orders this event against MediaDeleted for projections.
	Version int `json:"version"`
}

// MediaDeletedEvent is the payload of MediaDeletedEventType.
type MediaDeletedEvent struct {
	MediaID   string    `json:"media_id"`
	UserID    string    `json:"user_id"`
	DeletedAt time.Time `json:"deleted_at"`
	Version   int       `json:"version"`
}
