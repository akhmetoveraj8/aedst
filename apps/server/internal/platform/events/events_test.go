package events

import (
	"context"
	"errors"
	"log/slog"
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
	var cancel *river.JobCancelError
	if errors.As(err, &cancel) {
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
	var cancel *river.JobCancelError
	if !errors.As(err, &cancel) {
		t.Fatalf("Work() = %v, want river.JobCancel (retrying can never succeed)", err)
	}
}
