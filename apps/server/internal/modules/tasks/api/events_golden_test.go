package api_test

import (
	"testing"

	"github.com/aedst/server/internal/modules/tasks/api"
	"github.com/aedst/server/internal/platform/events/goldentest"
)

// TestEventPayloadsMatchGoldenFixtures pins the wire format of every event this
// module publishes (testdata/<Event>.v<N>.json). A breaking change is a new event
// version with a new fixture; see internal/platform/events/goldentest.
func TestEventPayloadsMatchGoldenFixtures(t *testing.T) {
	goldentest.Check(t, "testdata", []goldentest.Case{
		{Type: api.TaskCompletedEventType, Version: api.TaskCompletedEventVersion, New: func() any { return new(api.TaskCompletedEvent) }},
		{Type: api.TaskCreatedEventType, Version: api.TaskCreatedEventVersion, New: func() any { return new(api.TaskSnapshot) }},
		{Type: api.TaskUpdatedEventType, Version: api.TaskUpdatedEventVersion, New: func() any { return new(api.TaskSnapshot) }},
		{Type: api.TaskDeletedEventType, Version: api.TaskDeletedEventVersion, New: func() any { return new(api.TaskDeletedEvent) }},
		{Type: api.TaskDueSoonEventType, Version: api.TaskDueSoonEventVersion, New: func() any { return new(api.TaskDueSoonEvent) }},
	})
}
