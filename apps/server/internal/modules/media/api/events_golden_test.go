package api_test

import (
	"testing"

	"github.com/aedst/server/internal/modules/media/api"
	"github.com/aedst/server/internal/platform/events/goldentest"
)

// TestEventPayloadsMatchGoldenFixtures pins the wire format of every event this
// module publishes (testdata/<Event>.v<N>.json). A breaking change is a new event
// version with a new fixture; see internal/platform/events/goldentest.
func TestEventPayloadsMatchGoldenFixtures(t *testing.T) {
	goldentest.Check(t, "testdata", []goldentest.Case{
		{Type: api.MediaReadyEventType, Version: api.MediaReadyEventVersion, New: func() any { return new(api.MediaReadyEvent) }},
		{Type: api.MediaDeletedEventType, Version: api.MediaDeletedEventVersion, New: func() any { return new(api.MediaDeletedEvent) }},
	})
}
