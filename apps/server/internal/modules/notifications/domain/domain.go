// Package domain holds the notifications module's entities. It imports
// nothing outside the standard library and shared primitives (see
// docs/content/server/modules.md).
package domain

import (
	"fmt"
	"strings"
	"time"
	"unicode/utf8"

	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// Kind classifies a notification so clients can pick an icon and a route.
type Kind string

const (
	KindTaskCompleted Kind = "task_completed"
	KindTaskDueSoon   Kind = "task_due_soon"
	KindMediaReady    Kind = "media_ready"
	KindSystem        Kind = "system"
)

// Field limits (mirrored by notifications.proto / admin.proto).
const (
	MaxTitleLength = 120
	MaxBodyLength  = 1000
	MaxLinkLength  = 500
)

// Notification is one entry in a user's feed. It is a projection of an
// integration event published by another module (or of an operator
// broadcast); SourceEventID ties it to that event so applying the same event
// twice yields one notification.
type Notification struct {
	ID     ids.ID
	UserID ids.ID
	Kind   Kind
	Title  string
	Body   string
	// Link is a relative in-app route ("/tasks/<id>"); never an absolute URL.
	Link          string
	SubjectID     *ids.ID
	SourceEventID ids.ID
	CreatedAt     time.Time
	ReadAt        *time.Time
}

func (n Notification) IsRead() bool { return n.ReadAt != nil }

// NewTaskCompleted builds the notification for a completed task. createdAt is
// the event's own timestamp, not "now", so a redelivered event is identical.
func NewTaskCompleted(userID, sourceEventID, taskID ids.ID, taskTitle string, createdAt time.Time) Notification {
	return Notification{
		ID:            ids.New(),
		UserID:        userID,
		Kind:          KindTaskCompleted,
		Title:         truncate(fmt.Sprintf("Task completed: %s", taskTitle), MaxTitleLength),
		Link:          "/tasks/" + taskID.String(),
		SubjectID:     &taskID,
		SourceEventID: sourceEventID,
		CreatedAt:     createdAt,
	}
}

// NewTaskDueSoon builds the reminder for a task whose due date is near.
func NewTaskDueSoon(userID, sourceEventID, taskID ids.ID, taskTitle string, due, createdAt time.Time) Notification {
	return Notification{
		ID:            ids.New(),
		UserID:        userID,
		Kind:          KindTaskDueSoon,
		Title:         truncate(fmt.Sprintf("Due soon: %s", taskTitle), MaxTitleLength),
		Body:          "Due " + due.UTC().Format(time.RFC3339),
		Link:          "/tasks/" + taskID.String(),
		SubjectID:     &taskID,
		SourceEventID: sourceEventID,
		CreatedAt:     createdAt,
	}
}

// NewMediaReady builds the notification for a processed upload.
func NewMediaReady(userID, sourceEventID, mediaID ids.ID, filename string, createdAt time.Time) Notification {
	return Notification{
		ID:            ids.New(),
		UserID:        userID,
		Kind:          KindMediaReady,
		Title:         truncate(fmt.Sprintf("Ready: %s", filename), MaxTitleLength),
		Link:          "/media/" + mediaID.String(),
		SubjectID:     &mediaID,
		SourceEventID: sourceEventID,
		CreatedAt:     createdAt,
	}
}

// Broadcast is an operator-sent SYSTEM notification.
type Broadcast struct {
	Title string
	Body  string
	Link  string
}

// Validate enforces the broadcast invariants (the domain is the authority,
// whatever entry point created it).
func (b *Broadcast) Validate() error {
	b.Title = strings.TrimSpace(b.Title)
	switch {
	case b.Title == "":
		return sharederrors.Validation("notifications.Broadcast", "title must not be empty")
	case utf8.RuneCountInString(b.Title) > MaxTitleLength:
		return sharederrors.Validation("notifications.Broadcast", "title is too long")
	case utf8.RuneCountInString(b.Body) > MaxBodyLength:
		return sharederrors.Validation("notifications.Broadcast", "body is too long")
	case len(b.Link) > MaxLinkLength:
		return sharederrors.Validation("notifications.Broadcast", "link is too long")
	case b.Link != "" && (!strings.HasPrefix(b.Link, "/") || strings.HasPrefix(b.Link, "//")):
		// Relative only: an absolute or protocol-relative link would turn a
		// trusted system notification into an open redirect.
		return sharederrors.Validation("notifications.Broadcast", "link must be a relative in-app route")
	}
	return nil
}

// Preferences are a user's notification switches.
type Preferences struct {
	PushEnabled   bool
	TaskCompleted bool
	TaskDueSoon   bool
	MediaReady    bool
}

// DefaultPreferences apply until a user saves their own.
func DefaultPreferences() Preferences {
	return Preferences{PushEnabled: true, TaskCompleted: true, TaskDueSoon: true, MediaReady: true}
}

// WantsPush reports whether a notification of kind should be pushed. In-app
// entries are always created; preferences only gate the push.
func (p Preferences) WantsPush(kind Kind) bool {
	if !p.PushEnabled {
		return false
	}
	switch kind {
	case KindTaskCompleted:
		return p.TaskCompleted
	case KindTaskDueSoon:
		return p.TaskDueSoon
	case KindMediaReady:
		return p.MediaReady
	default:
		return true // system messages
	}
}

// Platform is a push channel.
type Platform string

const (
	PlatformWebPush Platform = "web_push"
	PlatformFCM     Platform = "fcm"
	PlatformAPNs    Platform = "apns"
)

// Device is one push registration.
type Device struct {
	ID       ids.ID
	UserID   ids.ID
	Platform Platform
	// Address is the FCM/APNs token or the Web Push endpoint.
	Address     string
	P256dh      string
	AuthSecret  string
	APNsTopic   string
	APNsSandbox bool
	DeviceName  string
	Locale      string
	CreatedAt   time.Time
}

// NewDevice validates a registration.
func NewDevice(userID ids.ID, platform Platform, token, endpoint, p256dh, auth, apnsTopic string, apnsSandbox bool, name, locale string, now time.Time) (Device, error) {
	d := Device{ID: ids.New(), UserID: userID, Platform: platform, APNsTopic: apnsTopic, APNsSandbox: apnsSandbox, DeviceName: name, Locale: locale, CreatedAt: now}
	switch platform {
	case PlatformWebPush:
		if !strings.HasPrefix(endpoint, "https://") {
			return Device{}, sharederrors.Validation("notifications.Device", "web push endpoint must be an https URL")
		}
		if p256dh == "" || auth == "" {
			return Device{}, sharederrors.Validation("notifications.Device", "web push subscription keys are required")
		}
		d.Address, d.P256dh, d.AuthSecret = endpoint, p256dh, auth
	case PlatformFCM, PlatformAPNs:
		if strings.TrimSpace(token) == "" {
			return Device{}, sharederrors.Validation("notifications.Device", "token is required")
		}
		d.Address = strings.TrimSpace(token)
	default:
		return Device{}, sharederrors.Validation("notifications.Device", "unknown push platform")
	}
	return d, nil
}

func truncate(s string, max int) string {
	if utf8.RuneCountInString(s) <= max {
		return s
	}
	r := []rune(s)
	return string(r[:max-1]) + "…"
}
