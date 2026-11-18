package config

import (
	"net/url"
	"slices"
)

// EventsConfig configures delivery of integration events across a database
// boundary (apps/server/docs/adr/0022-event-forwarding-and-service-identity.md). Both settings are
// off by default: events between units that share a database never use them.
type EventsConfig struct {
	// Forward maps a consumer unit that lives in another service with its own
	// database to that service's base URL (AEDST_EVENTS_FORWARD="notifications=https://n.internal,search=https://s.internal").
	// A producer here inserts a platform.event_forward job for each such consumer
	// instead of a delivery. It needs the service identity (AEDST_SERVICE_IDENTITY_*).
	Forward map[string]string `env:"AEDST_EVENTS_FORWARD" envSeparator:"," envKeyValSeparator:"=" envDefault:""`
	// IngestEnabled mounts EventIngestService, the endpoint a forwarding producer
	// calls, on this process. It admits only the "internal" role.
	IngestEnabled bool `env:"AEDST_EVENTS_INGEST_ENABLED" envDefault:"false"`
}

func (c Config) validateEvents(bad func(string, ...any)) {
	e := c.Events
	if len(e.Forward) > 0 && !c.ServiceIdentity.Enabled() {
		bad("AEDST_EVENTS_FORWARD needs the service identity (AEDST_SERVICE_IDENTITY_TOKEN_URL, _CLIENT_ID, _CLIENT_SECRET): a forward is a call with no user")
	}
	for unit, raw := range e.Forward {
		u, err := url.Parse(raw)
		switch {
		case unit == "" || err != nil || u.Host == "":
			bad("AEDST_EVENTS_FORWARD entry %q=%q must be <unit>=<base URL>", unit, raw)
		case u.Scheme != "https" && (u.Scheme != "http" || c.Env.IsDeployed()):
			bad("AEDST_EVENTS_FORWARD URL for %q must use https (http is allowed only outside staging/production)", unit)
		}
		if slices.Contains(c.Topology.Enabled, unit) {
			bad("AEDST_EVENTS_FORWARD names %q, which this process hosts (AEDST_MODULES): a hosted consumer is delivered locally", unit)
		}
	}
}
