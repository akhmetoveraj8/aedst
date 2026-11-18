package modulekit

import (
	"context"
	"slices"
	"testing"

	"github.com/aedst/server/internal/platform/events"
)

func consumingRegistry() map[string]Module {
	return map[string]Module{
		"tasks":         {Name: "tasks"},
		"notifications": {Name: "notifications", Consumes: []Consume{{"tasks.v1.TaskCompleted", "notifications.task_completed"}}},
		"search":        {Name: "search", Consumes: []Consume{{"tasks.v1.TaskCompleted", "search.task_completed"}, {"media.v1.MediaReady", "search.media_ready"}}},
	}
}

// The producer process hosts only tasks: it must still insert a delivery for
// every consumer in the units it does not host, or those events are lost.
func TestPlan_NotHostedConsumersGoIntoTheCatalog(t *testing.T) {
	plan, err := selectUnits(consumingRegistry(), []string{"tasks"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	reg := events.NewRegistry()
	plan.RegisterRemoteConsumers(reg)
	got := reg.Consumers("tasks.v1.TaskCompleted")
	if !slices.Equal(got, []string{"notifications.task_completed", "search.task_completed"}) {
		t.Fatalf("catalog for TaskCompleted = %v, want both remote consumers", got)
	}
	if got := reg.Consumers("media.v1.MediaReady"); !slices.Equal(got, []string{"search.media_ready"}) {
		t.Fatalf("catalog for MediaReady = %v", got)
	}
	if len(plan.ConsumingUnits()) != 0 {
		t.Fatalf("ConsumingUnits = %v, want none: tasks subscribes to nothing", plan.ConsumingUnits())
	}
}

// A hosted unit's consumers are registered by its own Setup, so they must not
// also be catalogued as remote (that would panic as a duplicate consumer).
func TestPlan_HostedConsumersAreNotCataloguedAsRemote(t *testing.T) {
	plan, err := selectUnits(consumingRegistry(), []string{"tasks", "notifications"}, nil)
	if err != nil {
		t.Fatal(err)
	}
	reg := events.NewRegistry()
	reg.Subscribe("tasks.v1.TaskCompleted", "notifications.task_completed", func(context.Context, events.Event) error { return nil })
	plan.RegisterRemoteConsumers(reg) // panics on a duplicate
	if got := reg.Consumers("tasks.v1.TaskCompleted"); !slices.Equal(got, []string{"notifications.task_completed", "search.task_completed"}) {
		t.Fatalf("Consumers = %v", got)
	}
	if got := plan.ConsumingUnits(); !slices.Equal(got, []string{"notifications"}) {
		t.Fatalf("ConsumingUnits = %v, want [notifications]", got)
	}
}

func TestPlan_TheMonolithHasNoRemoteConsumers(t *testing.T) {
	plan, err := selectUnits(consumingRegistry(), nil, nil)
	if err != nil {
		t.Fatal(err)
	}
	if len(plan.Others) != 0 {
		t.Fatalf("Others = %v, want none", plan.Others)
	}
	if got := plan.ConsumingUnits(); !slices.Equal(got, []string{"notifications", "search"}) {
		t.Fatalf("ConsumingUnits = %v, want both consumers (their event queues are worked)", got)
	}
}
