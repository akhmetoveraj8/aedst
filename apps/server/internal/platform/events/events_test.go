package events

import (
	"context"
	"errors"
	"log/slog"
	"maps"
	"strings"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/shared/ids"
)

func TestRegistry_ConsumersInRegistrationOrder(t *testing.T) {
	r := NewRegistry()
	noop := func(context.Context, Event) error { return nil }
	r.Subscribe("a.v1.A", "x.first", noop)
	r.Subscribe("a.v1.A", "y.second", noop)
	r.Subscribe("b.v1.B", "z.other", noop)

	got := r.Consumers("a.v1.A")
	if len(got) != 2 || got[0] != "x.first" || got[1] != "y.second" {
		t.Fatalf("Consumers(a) = %v, want [x.first y.second]", got)
	}
	if got := r.Consumers("none"); len(got) != 0 {
		t.Fatalf("Consumers(none) = %v, want empty", got)
	}
	// The returned slice is a copy: mutating it must not corrupt the registry.
	got[0] = "tampered"
	if r.Consumers("a.v1.A")[0] != "x.first" {
		t.Fatal("Consumers leaked its internal slice")
	}
}

func TestRegistry_DuplicateConsumerPanics(t *testing.T) {
	r := NewRegistry()
	noop := func(context.Context, Event) error { return nil }
	r.Subscribe("a.v1.A", "dup", noop)
	defer func() {
		if recover() == nil {
			t.Fatal("duplicate consumer name did not panic")
		}
	}()
	r.Subscribe("b.v1.B", "dup", noop)
}

func TestDeliveryArgs_UniqueByConsumerAndEvent(t *testing.T) {
	opts := DeliveryArgs{}.InsertOpts()
	if !opts.UniqueOpts.ByArgs || opts.MaxAttempts != maxAttempts {
		t.Fatalf("InsertOpts = %+v, want ByArgs unique and %d attempts", opts, maxAttempts)
	}
}

func newJob(args DeliveryArgs, attempt, maxAttempts int) *river.Job[DeliveryArgs] {
	return &river.Job[DeliveryArgs]{Args: args, JobRow: &rivertype.JobRow{Attempt: attempt, MaxAttempts: maxAttempts}}
}

func validArgs(consumer string) DeliveryArgs {
	return DeliveryArgs{
		Consumer: consumer, EventID: ids.New().String(), EventType: "a.v1.A", EventVersion: 1,
		OccurredAt: time.Now(), PartitionKey: ids.New().String(), Payload: []byte(`{"k":"v"}`),
	}
}

func TestWorker_DeliversToTheNamedConsumer(t *testing.T) {
	r := NewRegistry()
	var got Event
	r.Subscribe("a.v1.A", "m.one", func(_ context.Context, e Event) error { got = e; return nil })
	r.Subscribe("a.v1.A", "m.two", func(context.Context, Event) error { t.Error("wrong consumer ran"); return nil })
	w, err := newWorker(r, slog.New(slog.DiscardHandler))
	if err != nil {
		t.Fatal(err)
	}

	args := validArgs("m.one")
	if err := w.Work(context.Background(), newJob(args, 1, maxAttempts)); err != nil {
		t.Fatalf("Work() = %v", err)
	}
	if got.ID.String() != args.EventID || got.Type != "a.v1.A" || got.Version != 1 || string(got.Payload) != `{"k":"v"}` {
		t.Fatalf("handler saw %+v, want the delivered event %+v", got, args)
	}
}

func TestWorker_HandlerErrorIsRetried(t *testing.T) {
	r := NewRegistry()
	boom := errors.New("boom")
	r.Subscribe("a.v1.A", "m.flaky", func(context.Context, Event) error { return boom })
	w, _ := newWorker(r, slog.New(slog.DiscardHandler))

	err := w.Work(context.Background(), newJob(validArgs("m.flaky"), 1, maxAttempts))
	if !errors.Is(err, boom) {
		t.Fatalf("Work() = %v, want the handler error (River retries it with backoff)", err)
	}
}

// A replica older than the producer does not know a new consumer yet: that must
// be retried, not cancelled, or a rolling deploy would drop events.
func TestWorker_UnknownConsumerIsRetriedNotCancelled(t *testing.T) {
	w, _ := newWorker(NewRegistry(), slog.New(slog.DiscardHandler))
	err := w.Work(context.Background(), newJob(validArgs("not.yet.deployed"), 1, maxAttempts))
	if err == nil {
		t.Fatal("Work() = nil for an unknown consumer")
	}
	if _, ok := errors.AsType[*river.JobCancelError](err); ok {
		t.Fatalf("unknown consumer was cancelled: %v", err)
	}
}

func TestWorker_MalformedDeliveryIsCancelled(t *testing.T) {
	r := NewRegistry()
	r.Subscribe("a.v1.A", "m.one", func(context.Context, Event) error { t.Error("handler ran for a malformed delivery"); return nil })
	w, _ := newWorker(r, slog.New(slog.DiscardHandler))

	args := validArgs("m.one")
	args.EventID = "not-a-uuid"
	err := w.Work(context.Background(), newJob(args, 1, maxAttempts))
	if _, ok := errors.AsType[*river.JobCancelError](err); !ok {
		t.Fatalf("Work() = %v, want river.JobCancel (retrying can never succeed)", err)
	}
}

func TestQueueFor(t *testing.T) {
	for consumer, want := range map[string]string{
		"notifications.task_completed": "events_notifications",
		"search.task_created":          "events_search",
		"social_like.counted":          "events_social_like",
		"nodot":                        "events_nodot",
	} {
		if got := QueueFor(consumer); got != want {
			t.Errorf("QueueFor(%q) = %q, want %q", consumer, got, want)
		}
	}
	if got := QueueOfUnit("social/like"); got != "events_social_like" {
		t.Errorf("QueueOfUnit(social/like) = %q", got)
	}
	// A consumer named for a feature unit lands on that unit's queue.
	if QueueFor("social_like.x") != QueueOfUnit("social/like") {
		t.Error("a feature's consumer and its unit disagree on the queue")
	}
}

func TestIsQueue(t *testing.T) {
	for name, want := range map[string]bool{
		"events_notifications": true, "events_social_like": true, "events_a1": true,
		"default": false, "media": false, "events_": false, "events__x": false, "events_X": false, "events_a-b": false,
	} {
		if got := IsQueue(name); got != want {
			t.Errorf("IsQueue(%q) = %v, want %v", name, got, want)
		}
	}
}

func TestDeliveryArgs_GoToTheConsumersUnitQueue(t *testing.T) {
	if q := (DeliveryArgs{Consumer: "notifications.task_completed"}).InsertOpts().Queue; q != "events_notifications" {
		t.Fatalf("queue = %q, want events_notifications", q)
	}
}

func TestWorkedQueues(t *testing.T) {
	hosted := []string{"notifications", "social/like"}
	t.Run("default plus every hosted unit queue", func(t *testing.T) {
		got := WorkedQueues(map[string]int{"default": 50, "media": 2}, hosted, 10)
		want := map[string]int{"default": 50, "media": 2, "events_notifications": 10, "events_social_like": 10}
		if !maps.Equal(got, want) {
			t.Fatalf("got %v, want %v", got, want)
		}
	})
	t.Run("a media-only worker takes no event queue", func(t *testing.T) {
		got := WorkedQueues(map[string]int{"media": 4}, hosted, 10)
		if !maps.Equal(got, map[string]int{"media": 4}) {
			t.Fatalf("got %v, want only media", got)
		}
	})
	t.Run("insert-only stays insert-only", func(t *testing.T) {
		if got := WorkedQueues(nil, hosted, 10); len(got) != 0 {
			t.Fatalf("got %v, want none", got)
		}
	})
	t.Run("an explicit count is kept", func(t *testing.T) {
		got := WorkedQueues(map[string]int{"default": 5, "events_notifications": 3}, hosted, 10)
		if got["events_notifications"] != 3 || got["events_social_like"] != 10 {
			t.Fatalf("got %v", got)
		}
	})
	t.Run("the configured map is not mutated", func(t *testing.T) {
		in := map[string]int{"default": 5}
		WorkedQueues(in, hosted, 10)
		if len(in) != 1 {
			t.Fatalf("input mutated: %v", in)
		}
	})
}

func TestRegistry_RemoteConsumersAreInTheCatalogOnly(t *testing.T) {
	r := NewRegistry()
	r.Subscribe("a.v1.A", "x.local", func(context.Context, Event) error { return nil })
	r.SubscribeRemote("a.v1.A", "y.remote")
	if got := r.Consumers("a.v1.A"); len(got) != 2 || got[1] != "y.remote" {
		t.Fatalf("Consumers = %v, want local then remote", got)
	}
	err := r.Dispatch(context.Background(), Event{Type: "a.v1.A"})
	if err == nil || !strings.Contains(err.Error(), "y.remote") {
		t.Fatalf("Dispatch = %v, want an error naming the remote consumer, not a silent skip or a nil-handler panic", err)
	}
	defer func() {
		if recover() == nil {
			t.Fatal("a remote consumer named like a hosted one did not panic")
		}
	}()
	r.SubscribeRemote("a.v1.A", "x.local")
}

// A remote consumer's delivery that reaches a process without its handler must
// fail visibly (retried, then discarded), never complete: that would lose the event.
func TestWorker_RemoteConsumerIsNeverCompleted(t *testing.T) {
	r := NewRegistry()
	r.SubscribeRemote("a.v1.A", "y.remote")
	w, _ := newWorker(r, slog.New(slog.DiscardHandler))
	err := w.Work(context.Background(), newJob(validArgs("y.remote"), 1, maxAttempts))
	if err == nil {
		t.Fatal("Work() = nil for a consumer hosted elsewhere: the event would be lost")
	}
	if _, ok := errors.AsType[*river.JobCancelError](err); ok {
		t.Fatalf("remote consumer was cancelled: %v", err)
	}
}

// Deliveries inserted before this change sit on the "default" queue. Workers are
// registered by job kind, not by queue, so any process that works "default" still
// delivers them: the queue of a job row is only where River looks, not which
// worker runs it.
func TestLegacyDefaultQueueDeliveriesStillRun(t *testing.T) {
	r := NewRegistry()
	var ran bool
	r.Subscribe("a.v1.A", "m.one", func(context.Context, Event) error { ran = true; return nil })
	w, _ := newWorker(r, slog.New(slog.DiscardHandler))
	job := newJob(validArgs("m.one"), 1, maxAttempts)
	job.Queue = river.QueueDefault
	if err := w.Work(context.Background(), job); err != nil || !ran {
		t.Fatalf("a delivery on the default queue: err = %v, ran = %v", err, ran)
	}
}
