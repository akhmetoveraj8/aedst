package module

import (
	mediaapi "github.com/aedst/server/internal/modules/media/api"
	tasksapi "github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/platform/modulekit"
)

// consumes is what infrastructure/events subscribes to (architecturetest keeps
// the two equal): one fan-out consumer per event type offered to endpoints.
// Offering another event to webhooks is one line here and one Subscribe there.
var consumes = []modulekit.Consume{
	{EventType: tasksapi.TaskCreatedEventType, Consumer: "webhooks.fanout_task_created"},
	{EventType: tasksapi.TaskUpdatedEventType, Consumer: "webhooks.fanout_task_updated"},
	{EventType: tasksapi.TaskCompletedEventType, Consumer: "webhooks.fanout_task_completed"},
	{EventType: tasksapi.TaskDeletedEventType, Consumer: "webhooks.fanout_task_deleted"},
	{EventType: tasksapi.TaskDueSoonEventType, Consumer: "webhooks.fanout_task_due_soon"},
	{EventType: mediaapi.MediaReadyEventType, Consumer: "webhooks.fanout_media_ready"},
	{EventType: mediaapi.MediaDeletedEventType, Consumer: "webhooks.fanout_media_deleted"},
}

// OfferedEventTypes are the event types an endpoint may subscribe to: exactly
// the ones the fan-out consumes.
func OfferedEventTypes() []string {
	out := make([]string, len(consumes))
	for i, c := range consumes {
		out[i] = c.EventType
	}
	return out
}
