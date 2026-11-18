package modulekit

import (
	"fmt"
	"slices"

	"github.com/aedst/server/internal/platform/events"
)

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

// RegisterConsumers is RegisterRemoteConsumers for a process that forwards some
// units' events over the network: a unit named in forward (AEDST_EVENTS_FORWARD) has
// its own database, so its consumers are catalogued as forwarded and a producer here
// inserts a platform.event_forward job for them instead of a delivery. A unit that is
// not registered, or that this process hosts, is a configuration error.
func (p Plan) RegisterConsumers(registry *events.Registry, forward map[string]string) error {
	for unit := range forward {
		switch {
		case p.Hosts(unit):
			return fmt.Errorf("modulekit: AEDST_EVENTS_FORWARD names %q, which this process hosts", unit)
		case !slices.ContainsFunc(p.Others, func(m Module) bool { return m.Name == unit }):
			return fmt.Errorf("modulekit: AEDST_EVENTS_FORWARD names %q, which is not a registered unit", unit)
		}
	}
	for _, m := range p.Others {
		_, forwarded := forward[m.Name]
		for _, c := range m.Consumes {
			if forwarded {
				registry.SubscribeForwarded(c.EventType, c.Consumer, m.Name)
			} else {
				registry.SubscribeRemote(c.EventType, c.Consumer)
			}
		}
	}
	return nil
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
