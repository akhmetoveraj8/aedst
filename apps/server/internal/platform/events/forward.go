package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"log/slog"
	"time"

	"github.com/riverqueue/river"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"

	sharederrors "github.com/aedst/server/internal/shared/errors"
)

// Event forwarding is how an integration event crosses a database boundary
// (apps/server/docs/adr/0022-event-forwarding-and-service-identity.md). A consumer registered with
// SubscribeForwarded lives in another service with its own database, so the
// producer cannot insert the consumer's delivery in its own River tables (the
// consumer's process would never see it). Instead the producer inserts a
// platform.event_forward job, in the same transaction as the state change (River
// stays the outbox, no dual write); the job calls the consumer's
// EventIngestService, which inserts the real delivery job in the consumer's own
// database. Each side keeps its own retries, discards and metrics, and the
// delivery is idempotent on (consumer, event id) at both hops.

// ForwardKind is the River job kind of a forwarded delivery.
const ForwardKind = "platform.event_forward"

// ForwardQueue is the River queue of forward jobs. A process that works "default"
// and has forwarded consumers works it too (WorkedQueues does not add it; the
// composition root does, see cmd/server).
const ForwardQueue = "events_forward"

// ForwardArgs is the River job that hands one event delivery to the service that
// hosts its consumer. Consumer and EventID are the unique key, like DeliveryArgs.
type ForwardArgs struct {
	// Unit is the consumer's unit, the key of AEDST_EVENTS_FORWARD.
	Unit         string          `json:"unit"`
	Consumer     string          `json:"consumer" river:"unique"`
	EventID      string          `json:"event_id" river:"unique"`
	EventType    string          `json:"event_type"`
	EventVersion uint32          `json:"event_version"`
	OccurredAt   time.Time       `json:"occurred_at"`
	PartitionKey string          `json:"partition_key"`
	Traceparent  string          `json:"traceparent,omitempty"`
	Payload      json.RawMessage `json:"payload"`
}

// Kind implements river.JobArgs.
func (ForwardArgs) Kind() string { return ForwardKind }

// InsertOpts implements river.JobArgsWithInsertOpts.
func (ForwardArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{
		Queue:       ForwardQueue,
		MaxAttempts: maxAttempts,
		UniqueOpts:  river.UniqueOpts{ByArgs: true},
	}
}

// Delivery is the delivery job the consumer's service inserts for this forward.
func (a ForwardArgs) Delivery() DeliveryArgs {
	return DeliveryArgs{
		Consumer: a.Consumer, EventID: a.EventID, EventType: a.EventType, EventVersion: a.EventVersion,
		OccurredAt: a.OccurredAt, PartitionKey: a.PartitionKey, Traceparent: a.Traceparent, Payload: a.Payload,
	}
}

func forwardOf(unit string, d DeliveryArgs) ForwardArgs {
	return ForwardArgs{
		Unit: unit, Consumer: d.Consumer, EventID: d.EventID, EventType: d.EventType, EventVersion: d.EventVersion,
		OccurredAt: d.OccurredAt, PartitionKey: d.PartitionKey, Traceparent: d.Traceparent, Payload: d.Payload,
	}
}

// Forwarder hands a delivery to the service that hosts its consumer. It returns
// nil when the delivery exists on the other side (created or already there). An
// error of kind NotFound, Validation or Forbidden is permanent; anything else is
// retried. The implementation is internal/platform/events/ingest.
type Forwarder interface {
	Forward(ctx context.Context, unit string, d DeliveryArgs) error
}

// SubscribeForwarded adds a consumer hosted by another service with its own
// database: a producer here inserts a platform.event_forward job for it instead of
// a delivery. unit is the consumer's unit (its AEDST_EVENTS_FORWARD key). It
// panics on a duplicate name, like Subscribe.
func (r *Registry) SubscribeForwarded(eventType, name, unit string) {
	if eventType == "" || name == "" || unit == "" {
		panic("events: SubscribeForwarded needs an event type, a consumer name and a unit")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.consumers[name]; dup {
		panic(fmt.Sprintf("events: duplicate consumer %q", name))
	}
	r.consumers[name] = consumer{name: name, eventType: eventType, forwardTo: unit}
	r.byType[eventType] = append(r.byType[eventType], name)
}

// Hosts reports whether name is a consumer with a handler in this process (the
// ingest endpoint accepts deliveries for those only).
func (r *Registry) Hosts(name string) bool {
	c, ok := r.lookup(name)
	return ok && c.handle != nil
}

// TypeOf returns the event type consumer subscribes to, "" if it is unknown.
func (r *Registry) TypeOf(name string) string {
	c, _ := r.lookup(name)
	return c.eventType
}

// ForwardWorker runs the forward jobs.
type ForwardWorker struct {
	river.WorkerDefaults[ForwardArgs]
	forwarder Forwarder
	logger    *slog.Logger
	forwarded metric.Int64Counter
	failed    metric.Int64Counter
	discarded metric.Int64Counter
}

// Timeout bounds one forward call (a slow peer must not hold a River slot).
func (w *ForwardWorker) Timeout(*river.Job[ForwardArgs]) time.Duration { return deliveryTimeout }

// Work forwards one delivery.
func (w *ForwardWorker) Work(ctx context.Context, job *river.Job[ForwardArgs]) error {
	args := job.Args
	attrs := metric.WithAttributes(attribute.String("consumer", args.Consumer), attribute.String("unit", args.Unit))
	ctx = contextWithTraceparent(ctx, args.Traceparent)
	err := w.forwarder.Forward(ctx, args.Unit, args.Delivery())
	if err == nil {
		w.forwarded.Add(ctx, 1, attrs)
		return nil
	}
	var se *sharederrors.Error
	if errors.As(err, &se) && (se.Kind == sharederrors.KindNotFound || se.Kind == sharederrors.KindValidation || se.Kind == sharederrors.KindForbidden) {
		// The peer will never accept it (unknown consumer, malformed envelope, the
		// identity lacks the role): retrying cannot help. Cancel visibly.
		w.discarded.Add(ctx, 1, attrs)
		w.logger.ErrorContext(ctx, "events: forward rejected permanently",
			slog.String("consumer", args.Consumer), slog.String("event_id", args.EventID), slog.Any("error", err))
		return river.JobCancel(err)
	}
	last := job.Attempt >= job.MaxAttempts
	if last {
		w.discarded.Add(ctx, 1, attrs)
	} else {
		w.failed.Add(ctx, 1, attrs)
	}
	w.logger.WarnContext(ctx, "events: forward failed",
		slog.String("consumer", args.Consumer), slog.String("event_id", args.EventID),
		slog.Int("attempt", job.Attempt), slog.Bool("discarded", last), slog.Any("error", err))
	return err
}

// RegisterForward adds the forward worker to workers. Call it in every process
// (River validates job kinds on insert), before building the client.
func RegisterForward(workers *river.Workers, forwarder Forwarder, logger *slog.Logger) error {
	meter := otel.Meter(meterName)
	w := &ForwardWorker{forwarder: forwarder, logger: logger}
	var err error
	if w.forwarded, err = meter.Int64Counter("aedst_events_forwarded_total", metric.WithDescription("Event deliveries handed to the service that hosts their consumer.")); err != nil {
		return fmt.Errorf("events: metrics: %w", err)
	}
	if w.failed, err = meter.Int64Counter("aedst_events_forward_failed_total", metric.WithDescription("Forward attempts that failed and will be retried.")); err != nil {
		return fmt.Errorf("events: metrics: %w", err)
	}
	if w.discarded, err = meter.Int64Counter("aedst_events_forward_discarded_total", metric.WithDescription("Forwards abandoned after exhausting their attempts or rejected permanently.")); err != nil {
		return fmt.Errorf("events: metrics: %w", err)
	}
	if err := river.AddWorkerSafely(workers, w); err != nil {
		return fmt.Errorf("events: add forward worker: %w", err)
	}
	return nil
}

// refuseForward is the Forwarder of a process that has no forwarded consumers or
// no identity to forward with: a forward job must not complete silently.
type refuseForward struct{}

// NoForwarder returns a Forwarder that fails every call. Register it where
// forwarding is not configured: River validates job kinds on insert, so every
// process registers the worker, but one that has no forward targets must never
// swallow a job it should not have been given.
func NoForwarder() Forwarder { return refuseForward{} }

func (refuseForward) Forward(context.Context, string, DeliveryArgs) error {
	return errors.New("events: this process has no event forwarding configured (AEDST_EVENTS_FORWARD)")
}
