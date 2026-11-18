package modulekit

import "github.com/aedst/server/internal/platform/events"

// RegisterRemoteConsumers adds the declared subscriptions of every unit this
// process does not host to the event catalog, so a producer here inserts their
// deliveries (onto each unit's own queue) even though no handler runs here. Call
// it once, before any Setup can publish.
func (p Plan) RegisterRemoteConsumers(registry *events.Registry) {
	for _, m := range p.Others {
		for _, c := range m.Consumes {
			registry.SubscribeRemote(c.EventType, c.Consumer)
		}
	}
}

// ConsumingUnits returns the hosted units that subscribe to events: the ones
// whose event queue (events.QueueOfUnit) this process works.
func (p Plan) ConsumingUnits() []string {
	var out []string
	for _, m := range p.Local {
		if len(m.Consumes) > 0 {
			out = append(out, m.Name)
		}
	}
	return out
}
