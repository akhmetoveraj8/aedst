package events

import (
	"context"
	"fmt"
	"log/slog"
	"time"

	"github.com/riverqueue/river"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/codes"
	"go.opentelemetry.io/otel/metric"
	"go.opentelemetry.io/otel/trace"
)

const (
	meterName       = "github.com/aedst/server/internal/platform/events"
	deliveryTimeout = time.Minute
)

// Worker is the single River worker behind every consumer: it looks the
// consumer up in the Registry and runs its handler. Metrics (all labelled
// consumer):
//
//	aedst_events_delivered_total   deliveries that completed
//	aedst_events_failed_total      attempts that errored and will be retried
//	aedst_events_discarded_total   deliveries given up on (last attempt failed
//	                               or the job was cancelled) — page on any increase
//	aedst_events_delivery_lag_seconds  commit-to-handled latency histogram
//
// Queue-level lag (oldest available job, retryable/discarded counts) comes
// from platform/jobs' river_job gauges.
type Worker struct {
	river.WorkerDefaults[DeliveryArgs]
	registry  *Registry
	logger    *slog.Logger
	tracer    trace.Tracer
	delivered metric.Int64Counter
	failed    metric.Int64Counter
	discarded metric.Int64Counter
	lag       metric.Float64Histogram
	now       func() time.Time
}

// Timeout bounds one handler run; a stuck consumer must not hold a River slot.
func (w *Worker) Timeout(*river.Job[DeliveryArgs]) time.Duration { return deliveryTimeout }

// Work delivers one event to one consumer.
func (w *Worker) Work(ctx context.Context, job *river.Job[DeliveryArgs]) error {
	args := job.Args
	attrs := metric.WithAttributes(attribute.String("consumer", args.Consumer))

	c, ok := w.registry.lookup(args.Consumer)
	if !ok {
		// Not cancelled: during a rolling deploy this replica may simply be
		// older than the one that published the job. It is retried with
		// backoff and discarded (visibly) if no replica ever learns it.
		err := fmt.Errorf("events: unknown consumer %q", args.Consumer)
		w.recordFailure(ctx, job, attrs, err)
		return err
	}
	event, err := args.event()
	if err != nil {
		// A malformed delivery can never succeed: cancel instead of retrying.
		w.discarded.Add(ctx, 1, attrs)
		w.logger.ErrorContext(ctx, "events: malformed delivery cancelled",
			slog.String("consumer", args.Consumer), slog.String("event_id", args.EventID), slog.Any("error", err))
		return river.JobCancel(err)
	}

	ctx = contextWithTraceparent(ctx, args.Traceparent)
	ctx, span := w.tracer.Start(ctx, "events.deliver "+args.EventType, trace.WithSpanKind(trace.SpanKindConsumer),
		trace.WithAttributes(
			attribute.String("messaging.system", "river"),
			attribute.String("messaging.operation", "process"),
			attribute.String("events.consumer", args.Consumer),
			attribute.String("events.type", args.EventType),
			attribute.String("events.id", args.EventID),
			attribute.Int("events.attempt", job.Attempt),
		))
	defer span.End()

	if err := c.handle(ctx, event); err != nil {
		span.RecordError(err)
		span.SetStatus(codes.Error, err.Error())
		w.recordFailure(ctx, job, attrs, err)
		return err
	}
	w.delivered.Add(ctx, 1, attrs)
	if !event.OccurredAt.IsZero() {
		w.lag.Record(ctx, w.now().Sub(event.OccurredAt).Seconds(), attrs)
	}
	return nil
}

func (w *Worker) recordFailure(ctx context.Context, job *river.Job[DeliveryArgs], attrs metric.MeasurementOption, err error) {
	last := job.Attempt >= job.MaxAttempts
	if last {
		w.discarded.Add(ctx, 1, attrs)
	} else {
		w.failed.Add(ctx, 1, attrs)
	}
	w.logger.WarnContext(ctx, "events: delivery failed",
		slog.String("consumer", job.Args.Consumer), slog.String("event_id", job.Args.EventID),
		slog.Int("attempt", job.Attempt), slog.Bool("discarded", last), slog.Any("error", err))
}

// Register adds the delivery worker for registry to workers. Call it in every
// process (River validates job kinds on insert), before building the client.
func Register(workers *river.Workers, registry *Registry, logger *slog.Logger) error {
	w, err := newWorker(registry, logger)
	if err != nil {
		return err
	}
	if err := river.AddWorkerSafely(workers, w); err != nil {
		return fmt.Errorf("events: add worker: %w", err)
	}
	return nil
}

func newWorker(registry *Registry, logger *slog.Logger) (*Worker, error) {
	meter := otel.Meter(meterName)
	w := &Worker{registry: registry, logger: logger, tracer: otel.Tracer(meterName), now: time.Now}
	var err error
	if w.delivered, err = meter.Int64Counter("aedst_events_delivered_total", metric.WithDescription("Integration events delivered to a consumer.")); err != nil {
		return nil, fmt.Errorf("events: metrics: %w", err)
	}
	if w.failed, err = meter.Int64Counter("aedst_events_failed_total", metric.WithDescription("Event delivery attempts that failed and will be retried.")); err != nil {
		return nil, fmt.Errorf("events: metrics: %w", err)
	}
	if w.discarded, err = meter.Int64Counter("aedst_events_discarded_total", metric.WithDescription("Event deliveries abandoned after exhausting their attempts (or malformed).")); err != nil {
		return nil, fmt.Errorf("events: metrics: %w", err)
	}
	if w.lag, err = meter.Float64Histogram("aedst_events_delivery_lag_seconds", metric.WithUnit("s"),
		metric.WithDescription("Time from the event's commit to its consumer finishing.")); err != nil {
		return nil, fmt.Errorf("events: metrics: %w", err)
	}
	return w, nil
}
