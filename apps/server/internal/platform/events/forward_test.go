package events

import (
	"context"
	"errors"
	"log/slog"
	"testing"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

type captureInserter struct{ params []river.InsertManyParams }

func (c *captureInserter) InsertManyTx(_ context.Context, _ pgx.Tx, p []river.InsertManyParams) ([]*rivertype.JobInsertResult, error) {
	c.params = append(c.params, p...)
	return nil, nil
}

func TestPublish_ForwardedConsumerGetsAForwardJobNotADelivery(t *testing.T) {
	r := NewRegistry()
	noop := func(context.Context, Event) error { return nil }
	r.Subscribe("tasks.v1.TaskCompleted", "local.one", noop)
	r.SubscribeRemote("tasks.v1.TaskCompleted", "shared.two")
	r.SubscribeForwarded("tasks.v1.TaskCompleted", "notifications.task_completed", "notifications")

	ins := &captureInserter{}
	pub := NewRiverPublisher(r, ins, sharedtime.Real{})
	key := ids.New()
	id, err := pub.Publish(t.Context(), nil, "tasks.v1.TaskCompleted", 1, key, map[string]string{"user_id": "u"})
	if err != nil {
		t.Fatal(err)
	}
	if len(ins.params) != 3 {
		t.Fatalf("inserted %d jobs, want 3 (one per consumer)", len(ins.params))
	}
	if _, ok := ins.params[0].Args.(DeliveryArgs); !ok {
		t.Fatalf("hosted consumer got %T, want DeliveryArgs", ins.params[0].Args)
	}
	if _, ok := ins.params[1].Args.(DeliveryArgs); !ok {
		t.Fatalf("shared-database remote consumer got %T, want DeliveryArgs", ins.params[1].Args)
	}
	f, ok := ins.params[2].Args.(ForwardArgs)
	if !ok {
		t.Fatalf("forwarded consumer got %T, want ForwardArgs", ins.params[2].Args)
	}
	d := f.Delivery()
	if f.Unit != "notifications" || d.Consumer != "notifications.task_completed" || d.EventID != id.String() ||
		d.PartitionKey != key.String() || string(d.Payload) != `{"user_id":"u"}` {
		t.Fatalf("forward = %+v", f)
	}
	if opts := f.InsertOpts(); opts.Queue != ForwardQueue || !opts.UniqueOpts.ByArgs {
		t.Fatalf("InsertOpts = %+v, want the forward queue and unique by args", opts)
	}
}

func TestHostsAndTypeOf(t *testing.T) {
	r := NewRegistry()
	r.Subscribe("a.v1.A", "x.local", func(context.Context, Event) error { return nil })
	r.SubscribeRemote("a.v1.A", "y.remote")
	r.SubscribeForwarded("a.v1.A", "z.fwd", "z")
	if !r.Hosts("x.local") || r.Hosts("y.remote") || r.Hosts("z.fwd") || r.Hosts("nope") {
		t.Fatal("Hosts must be true only for a consumer with a handler here")
	}
	if r.TypeOf("z.fwd") != "a.v1.A" || r.TypeOf("nope") != "" {
		t.Fatal("TypeOf")
	}
}

type fakeForwarder struct{ err error }

func (f fakeForwarder) Forward(context.Context, string, DeliveryArgs) error { return f.err }

func forwardJob(attempt int) *river.Job[ForwardArgs] {
	return &river.Job[ForwardArgs]{
		Args:   ForwardArgs{Unit: "n", Consumer: "n.c", EventID: ids.New().String(), OccurredAt: time.Now()},
		JobRow: &rivertype.JobRow{Attempt: attempt, MaxAttempts: maxAttempts},
	}
}

func newForwardWorker(t *testing.T, f Forwarder) *ForwardWorker {
	t.Helper()
	workers := river.NewWorkers()
	if err := RegisterForward(workers, f, slog.Default()); err != nil {
		t.Fatal(err)
	}
	// RegisterForward owns the worker; build an equivalent one for direct calls.
	w := &ForwardWorker{forwarder: f, logger: slog.Default()}
	var err error
	if w.forwarded, w.failed, w.discarded, err = testCounters(); err != nil {
		t.Fatal(err)
	}
	return w
}

func TestForwardWorker(t *testing.T) {
	cases := []struct {
		name       string
		err        error
		wantCancel bool
		wantErr    bool
	}{
		{"delivered", nil, false, false},
		{"unavailable is retried", sharederrors.Wrap("x", context.DeadlineExceeded), false, true},
		{"unknown consumer is permanent", sharederrors.NotFound("x", "no consumer"), true, true},
		{"malformed envelope is permanent", sharederrors.Validation("x", "bad"), true, true},
		{"missing role is permanent", sharederrors.Forbidden("x", "no role"), true, true},
		{"plain error is retried", errors.New("boom"), false, true},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			w := newForwardWorker(t, fakeForwarder{err: c.err})
			err := w.Work(t.Context(), forwardJob(1))
			if (err != nil) != c.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, c.wantErr)
			}
			var cancel *river.JobCancelError
			if got := errors.As(err, &cancel); got != c.wantCancel {
				t.Fatalf("cancelled = %v, want %v (err %v)", got, c.wantCancel, err)
			}
		})
	}
}

func TestNoForwarderRefuses(t *testing.T) {
	if err := NoForwarder().Forward(t.Context(), "u", DeliveryArgs{}); err == nil {
		t.Fatal("a process with no forwarding configured must fail a forward job, never complete it")
	}
}
