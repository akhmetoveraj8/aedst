// Package events is the integration-event seam of the modular monolith. It
// replaces the former hand-built chain "outbox -> relay -> in-process bus ->
// inbox" with transactional River job insertion (docs/content/decisions/
// 0014-river-insert-tx-as-outbox.md):
//
//	domain change + Publisher.Publish   (one Postgres transaction: the state
//	        |                            change and one River job per consumer)
//	        v
//	River fetches the job               (any replica working the queue)
//	        v
//	Worker -> Registry handler          (the consumer; at-least-once, retried
//	                                     with River's backoff, discarded after
//	                                     MaxAttempts)
//
// The river_job table IS the outbox: InsertTx on the producer's pgx.Tx makes
// "committed implies scheduled" true by construction, one job per subscribed
// consumer gives each consumer its own retry/discard lifecycle, and no relay,
// polling loop, lease or separate inbox table exists. Because delivery is
// at-least-once, every handler must be idempotent (key the effect on
// Event.ID, or make it a version-guarded upsert).
//
// Each consumer's deliveries run on the queue of the unit that hosts it
// ("events_<unit>", QueueFor), and a process that hosts only some units learns
// the others' consumers from the static catalog (Registry.SubscribeRemote), so a
// producer never drops an event because its consumer lives elsewhere.
//
// Publisher (the interface) is the seam for a real broker: the day a consumer becomes its own
// service, a bridge consumer delivered by River forwards the event to a JetStream (or
// Kafka) subject; the event stays a river_job committed in the producer's transaction,
// never a second write beside it. Producers keep calling Publish. Do not add a broker before then.
//
// This package never depends on a wire format beyond "the payload is JSON":
// the payload type belongs to the producing module's api/ package.
package events

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"maps"
	"slices"
	"strings"
	"sync"
	"time"

	"github.com/jackc/pgx/v5"
	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"

	"github.com/aedst/server/internal/shared/ids"
	sharedtime "github.com/aedst/server/internal/shared/time"
)

// Event is one integration event as delivered to a consumer. ID is stable
// across redeliveries and retries — consumers dedupe on it.
type Event struct {
	ID           ids.ID
	Type         string
	Version      uint32
	OccurredAt   time.Time
	PartitionKey ids.ID
	// Payload is the JSON body serialized by the producing module.
	Payload []byte
}

// Handler applies one event. It must be idempotent: River delivers
// at-least-once, so a crash after the effect but before the job is marked
// complete runs the handler again with the same Event.ID. Returning an error
// retries the job with River's backoff; after MaxAttempts it is discarded and
// kept (DiscardedJobRetentionPeriod) for inspection and replay. Wrap
// permanent failures in river.JobCancel to stop retrying immediately.
type Handler func(ctx context.Context, event Event) error

// Registry maps event types to the consumers subscribed to them. Modules
// register their consumers at startup (cmd/server), in every process — also
// insert-only replicas, since the producing process decides the fan-out.
type Registry struct {
	mu        sync.RWMutex
	consumers map[string]consumer // by consumer name
	byType    map[string][]string // event type -> consumer names (registration order)
}

type consumer struct {
	name      string
	eventType string
	// handle is nil for a remote consumer: a unit hosted by another process that
	// is only in the catalog so this process's producers still insert its delivery.
	handle Handler
	// forwardTo is the consumer's unit when it lives in another service with its own
	// database (SubscribeForwarded): the producer inserts a forward job, not a delivery.
	forwardTo string
}

// NewRegistry returns an empty Registry.
func NewRegistry() *Registry {
	return &Registry{consumers: make(map[string]consumer), byType: make(map[string][]string)}
}

// Subscribe registers handler as consumer name for eventType, e.g.
// "notifications.task_completed" for "tasks.v1.TaskCompleted". Consumer names
// are stored in job args and must stay stable across deploys (renaming one
// strands its queued jobs); they must be unique. It panics on a duplicate name
// or a nil handler: both are wiring bugs found at startup.
func (r *Registry) Subscribe(eventType, name string, handler Handler) {
	if eventType == "" || name == "" || handler == nil {
		panic("events: Subscribe needs an event type, a consumer name and a handler")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.consumers[name]; dup {
		panic(fmt.Sprintf("events: duplicate consumer %q", name))
	}
	r.consumers[name] = consumer{name: name, eventType: eventType, handle: handler}
	r.byType[eventType] = append(r.byType[eventType], name)
}

// SubscribeRemote adds a consumer hosted by another process to the catalog: a
// producer in this process then inserts its delivery job (onto that consumer
// unit's own queue, see QueueFor) although no handler runs here. Without it a
// process that hosts only some units (AEDST_MODULES) would silently drop the
// events its neighbours consume. It panics on a duplicate name, like Subscribe: a
// unit is either hosted here or remote, never both.
func (r *Registry) SubscribeRemote(eventType, name string) {
	if eventType == "" || name == "" {
		panic("events: SubscribeRemote needs an event type and a consumer name")
	}
	r.mu.Lock()
	defer r.mu.Unlock()
	if _, dup := r.consumers[name]; dup {
		panic(fmt.Sprintf("events: duplicate consumer %q", name))
	}
	r.consumers[name] = consumer{name: name, eventType: eventType}
	r.byType[eventType] = append(r.byType[eventType], name)
}

// Consumers returns the consumer names subscribed to eventType.
func (r *Registry) Consumers(eventType string) []string {
	r.mu.RLock()
	defer r.mu.RUnlock()
	return slices.Clone(r.byType[eventType])
}

func (r *Registry) lookup(name string) (consumer, bool) {
	r.mu.RLock()
	defer r.mu.RUnlock()
	c, ok := r.consumers[name]
	return c, ok
}

// DeliveryKind is the River job kind of an event delivery.
const DeliveryKind = "platform.event_delivery"

// QueuePrefix starts the name of every event queue.
const QueuePrefix = "events_"

// QueueFor is the River queue that carries deliveries to consumer. Each unit has
// its own queue, "events_<unit>", so a process works only the deliveries of the
// units it hosts: a consumer-only worker (AEDST_MODULES=notifications) takes
// events_notifications and never a delivery it has no handler for. The unit is
// the part of the consumer name before the first ".", with a feature's "/"
// written "_" (consumer "notifications.task_completed" -> "events_notifications",
// "social_like.counted" -> "events_social_like"). River queue names allow letters,
// digits, "_" and "-" only, hence "_" and not ".".
func QueueFor(consumer string) string {
	unit, _, _ := strings.Cut(consumer, ".")
	return QueuePrefix + unit
}

// QueueOfUnit is the event queue of unit ("social/like" -> "events_social_like").
func QueueOfUnit(unit string) string {
	return QueuePrefix + strings.ReplaceAll(unit, "/", "_")
}

// IsQueue reports whether name is the name of an event queue.
func IsQueue(name string) bool {
	rest, ok := strings.CutPrefix(name, QueuePrefix)
	if !ok || rest == "" || len(name) > 64 {
		return false
	}
	for seg := range strings.SplitSeq(rest, "_") {
		if seg == "" {
			return false
		}
		for _, r := range seg {
			if (r < 'a' || r > 'z') && (r < '0' || r > '9') {
				return false
			}
		}
	}
	return true
}

// WorkedQueues is the queue set a process works: the configured queues plus, when
// it works the "default" queue (where deliveries used to run, so an operator who
// runs "default" still gets every delivery of the units it hosts), the event
// queue of each hosted unit that has consumers, with perQueue workers each. An
// explicitly configured queue is never overridden; an empty configuration stays
// empty (an insert-only process works nothing). hosted lists unit names that
// subscribe to events.
func WorkedQueues(configured map[string]int, hosted []string, perQueue int) map[string]int {
	if len(configured) == 0 {
		return configured
	}
	out := make(map[string]int, len(configured)+len(hosted))
	maps.Copy(out, configured)
	if _, ok := configured[river.QueueDefault]; !ok {
		return out
	}
	for _, unit := range hosted {
		if _, set := out[QueueOfUnit(unit)]; !set {
			out[QueueOfUnit(unit)] = perQueue
		}
	}
	return out
}

// maxAttempts mirrors the old outbox relay: 10 attempts with River's default
// backoff (attempt^4 seconds, ~ 2.5 h in total) before the job is discarded.
const maxAttempts = 10

// DeliveryArgs is the River job that delivers one event to one consumer. The
// unique key is (consumer, event id): publishing the same event id twice (a
// retried command that re-runs the producing transaction path) cannot create
// a second delivery while the first is pending, running, retrying or still
// retained as completed.
type DeliveryArgs struct {
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
func (DeliveryArgs) Kind() string { return DeliveryKind }

// InsertOpts implements river.JobArgsWithInsertOpts. The delivery goes to the
// consumer unit's own queue (QueueFor).
func (a DeliveryArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{
		Queue:       QueueFor(a.Consumer),
		MaxAttempts: maxAttempts,
		UniqueOpts:  river.UniqueOpts{ByArgs: true},
	}
}

func (a DeliveryArgs) event() (Event, error) {
	id, err := ids.Parse(a.EventID)
	if err != nil {
		return Event{}, fmt.Errorf("events: event id: %w", err)
	}
	key, err := ids.Parse(a.PartitionKey)
	if err != nil {
		return Event{}, fmt.Errorf("events: partition key: %w", err)
	}
	return Event{ID: id, Type: a.EventType, Version: a.EventVersion, OccurredAt: a.OccurredAt, PartitionKey: key, Payload: a.Payload}, nil
}

// TxInserter is the part of the River client the Publisher needs. Satisfied by
// *river.Client[pgx.Tx] (platform/jobs.Client), including an insert-only one.
type TxInserter interface {
	InsertManyTx(ctx context.Context, tx pgx.Tx, params []river.InsertManyParams) ([]*rivertype.JobInsertResult, error)
}

// Publisher writes events inside the producing module's transaction. It is the
// seam producers depend on; RiverPublisher is the only implementation (a future
// broker adapter would be River-delivered, never a dual write).
type Publisher interface {
	Publish(ctx context.Context, tx pgx.Tx, eventType string, version uint32, partitionKey ids.ID, payload any) (ids.ID, error)
}

// RiverPublisher fans events out as River jobs inserted on the producer's transaction.
type RiverPublisher struct {
	registry *Registry
	inserter TxInserter
	clock    sharedtime.Clock
}

// NewRiverPublisher builds a RiverPublisher that fans events out to registry's
// consumers through inserter.
func NewRiverPublisher(registry *Registry, inserter TxInserter, clock sharedtime.Clock) *RiverPublisher {
	return &RiverPublisher{registry: registry, inserter: inserter, clock: clock}
}

// Publish records the event eventType (payload is JSON-marshalled) inside tx,
// atomically with the state change that produced it: one River job per
// subscribed consumer. A type with no consumers is a successful no-op. The
// request's W3C traceparent is captured so each delivery stays in the
// originating trace. It returns the event id (stable for the event's life),
// useful for tests and logs.
func (p *RiverPublisher) Publish(ctx context.Context, tx pgx.Tx, eventType string, version uint32, partitionKey ids.ID, payload any) (ids.ID, error) {
	if p == nil || p.inserter == nil {
		return ids.Nil, errors.New("events: publisher has no River client")
	}
	body, err := json.Marshal(payload)
	if err != nil {
		return ids.Nil, fmt.Errorf("events: marshal %s: %w", eventType, err)
	}
	id := ids.New()
	names := p.registry.Consumers(eventType)
	if len(names) == 0 {
		return id, nil
	}
	traceparent := traceparentFromContext(ctx)
	occurred := p.clock.Now().UTC()
	params := make([]river.InsertManyParams, len(names))
	for i, name := range names {
		d := DeliveryArgs{
			Consumer: name, EventID: id.String(), EventType: eventType, EventVersion: version,
			OccurredAt: occurred, PartitionKey: partitionKey.String(), Traceparent: traceparent, Payload: body,
		}
		if c, ok := p.registry.lookup(name); ok && c.forwardTo != "" {
			params[i] = river.InsertManyParams{Args: forwardOf(c.forwardTo, d)}
			continue
		}
		params[i] = river.InsertManyParams{Args: d}
	}
	if _, err := p.inserter.InsertManyTx(ctx, tx, params); err != nil {
		return ids.Nil, fmt.Errorf("events: publish %s: %w", eventType, err)
	}
	return id, nil
}

func traceparentFromContext(ctx context.Context) string {
	carrier := propagation.MapCarrier{}
	otel.GetTextMapPropagator().Inject(ctx, carrier)
	return carrier.Get("traceparent")
}

func contextWithTraceparent(ctx context.Context, traceparent string) context.Context {
	if traceparent == "" {
		return ctx
	}
	return otel.GetTextMapPropagator().Extract(ctx, propagation.MapCarrier{"traceparent": traceparent})
}

// Dispatch runs every consumer subscribed to e.Type synchronously, in
// registration order, and returns their joined errors (all consumers run even
// if one fails). Production delivery goes through River (one job per consumer);
// Dispatch is for tests and for operator tooling that replays an event by hand.
func (r *Registry) Dispatch(ctx context.Context, e Event) error {
	var errs []error
	for _, name := range r.Consumers(e.Type) {
		c, ok := r.lookup(name)
		if !ok {
			continue
		}
		if c.handle == nil {
			errs = append(errs, fmt.Errorf("consumer %s: hosted by another process, not dispatchable here", name))
			continue
		}
		if err := c.handle(ctx, e); err != nil {
			errs = append(errs, fmt.Errorf("consumer %s: %w", name, err))
		}
	}
	return errors.Join(errs...)
}

var _ Publisher = (*RiverPublisher)(nil)
