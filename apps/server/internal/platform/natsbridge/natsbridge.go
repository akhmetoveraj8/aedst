// Package natsbridge forwards integration events to NATS JetStream so a
// separate service (the Rust WebSocket gateway, apps/gateway) can deliver them
// to clients. It is the broker adapter that ADR-0014 reserved behind
// events.Publisher and that ADR-0021 now adopts.
//
// There is no second write. A producer still commits the event as River jobs
// in its own transaction; the bridge is one more consumer in the events
// Registry (one per forwarded event type), so River retries it with backoff
// and discards it visibly. The forward is at-least-once: the event id is the
// JetStream `Nats-Msg-Id`, which deduplicates inside the stream's duplicate
// window; the gateway dedupes on the same id beyond it.
//
// Wire format: the message body is the Protobuf message
// aedst.events.v1.EventEnvelope (api/proto/aedst/events/v1/envelope.proto) in
// the binary encoding, with the header Content-Type: application/protobuf. The
// gateway decodes it with code generated from the same file (ADR-0026), so the
// contract is checked by `buf breaking`, not only by fixtures. The recipient is
// carried by the SUBJECT (aedst.events.user.<user id>.<event type>), not the
// body, so the body format is independent of routing. Only this package imports
// the NATS client.
package natsbridge

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"sync"
	"time"

	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/riverqueue/river"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/propagation"
	"google.golang.org/protobuf/proto"
	"google.golang.org/protobuf/types/known/timestamppb"

	eventsv1 "github.com/aedst/server/gen/go/aedst/events/v1"
	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/shared/ids"
)

// SubjectPrefix is the root of every subject the bridge publishes to.
const SubjectPrefix = "aedst.events.user"

// ConsumerPrefix prefixes the (stable, stored-in-job-args) River consumer
// names of the bridge: one per forwarded event type. Never rename.
const ConsumerPrefix = "platform.nats_forward:"

// Config configures the bridge.
type Config struct {
	// URL is the NATS server URL(s), comma separated.
	URL string
	// Stream is the JetStream stream that holds the events.
	Stream string
	// Replicas is the stream replica count (1 on a single node).
	Replicas int
	// MaxAge bounds how long the stream keeps an event (replay window).
	MaxAge time.Duration
	// DuplicateWindow is JetStream's dedup window for Nats-Msg-Id.
	DuplicateWindow time.Duration
	// RecipientField is the top-level payload field that names the recipient
	// user id (default "user_id").
	RecipientField string
	// PublishTimeout bounds one publish (connect, stream ensure and ack).
	PublishTimeout time.Duration
	// Options are extra nats.go options (credentials, TLS, tests).
	Options []nats.Option
}

// ContentType is the Content-Type header of every forwarded message.
const ContentType = "application/protobuf"

// NewEnvelope builds the wire envelope of e.
func NewEnvelope(e events.Event) *eventsv1.EventEnvelope {
	return &eventsv1.EventEnvelope{
		Id: e.ID.String(), Type: e.Type, Version: e.Version,
		OccurredAt: timestamppb.New(e.OccurredAt.UTC()), PartitionKey: e.PartitionKey.String(), Payload: e.Payload,
	}
}

// Subject is the NATS subject of an event for one recipient.
func Subject(userID, eventType string) string {
	return SubjectPrefix + "." + userID + "." + eventType
}

// Bridge publishes events to JetStream.
type Bridge struct {
	cfg Config
	nc  *nats.Conn
	js  jetstream.JetStream

	mu     sync.Mutex
	stream bool // stream ensured
}

// Connect opens the NATS connection. It does not fail when the server is
// unreachable (the API must not depend on the broker at startup): the client
// keeps retrying and a publish simply fails until it is back.
func Connect(cfg Config) (*Bridge, error) {
	if cfg.URL == "" {
		return nil, errors.New("natsbridge: URL is required")
	}
	if cfg.Stream == "" {
		cfg.Stream = "AEDST_EVENTS"
	}
	if cfg.RecipientField == "" {
		cfg.RecipientField = "user_id"
	}
	if cfg.Replicas < 1 {
		cfg.Replicas = 1
	}
	if cfg.MaxAge <= 0 {
		cfg.MaxAge = 24 * time.Hour
	}
	if cfg.DuplicateWindow <= 0 {
		cfg.DuplicateWindow = 2 * time.Minute
	}
	if cfg.PublishTimeout <= 0 {
		cfg.PublishTimeout = 5 * time.Second
	}
	opts := append([]nats.Option{
		nats.Name("aedst-server"),
		nats.RetryOnFailedConnect(true),
		nats.MaxReconnects(-1),
	}, cfg.Options...)
	nc, err := nats.Connect(cfg.URL, opts...)
	if err != nil {
		return nil, fmt.Errorf("natsbridge: connect: %w", err)
	}
	js, err := jetstream.New(nc)
	if err != nil {
		nc.Close()
		return nil, fmt.Errorf("natsbridge: jetstream: %w", err)
	}
	return &Bridge{cfg: cfg, nc: nc, js: js}, nil
}

// Close drains the connection.
func (b *Bridge) Close() {
	if b == nil || b.nc == nil {
		return
	}
	_ = b.nc.Drain()
}

// Subscribe registers the forward consumer for each event type on registry.
func (b *Bridge) Subscribe(registry *events.Registry, eventTypes []string) {
	for _, t := range eventTypes {
		registry.Subscribe(t, ConsumerPrefix+t, b.Forward)
	}
}

// EnsureStream creates (or updates) the JetStream stream now instead of on the
// first event, so a gateway that starts before any event finds it. Best effort
// at startup: Forward ensures it again.
func (b *Bridge) EnsureStream(ctx context.Context) error { return b.ensureStream(ctx) }

func (b *Bridge) ensureStream(ctx context.Context) error {
	b.mu.Lock()
	defer b.mu.Unlock()
	if b.stream {
		return nil
	}
	_, err := b.js.CreateOrUpdateStream(ctx, jetstream.StreamConfig{
		Name:       b.cfg.Stream,
		Subjects:   []string{SubjectPrefix + ".>"},
		Retention:  jetstream.LimitsPolicy,
		Storage:    jetstream.FileStorage,
		MaxAge:     b.cfg.MaxAge,
		Duplicates: b.cfg.DuplicateWindow,
		Replicas:   b.cfg.Replicas,
	})
	if err != nil {
		return fmt.Errorf("natsbridge: ensure stream %s: %w", b.cfg.Stream, err)
	}
	b.stream = true
	return nil
}

// Forward is the events.Handler of the bridge. It is idempotent: a retry
// publishes the same Nats-Msg-Id. A payload that does not name a valid
// recipient can never succeed, so it is cancelled instead of retried.
func (b *Bridge) Forward(ctx context.Context, e events.Event) error {
	recipient, err := recipientOf(e.Payload, b.cfg.RecipientField)
	if err != nil {
		return river.JobCancel(fmt.Errorf("natsbridge: %s %s: %w", e.Type, e.ID, err))
	}
	body, err := proto.Marshal(NewEnvelope(e))
	if err != nil {
		return river.JobCancel(fmt.Errorf("natsbridge: marshal: %w", err))
	}
	ctx, cancel := context.WithTimeout(ctx, b.cfg.PublishTimeout)
	defer cancel()
	if err := b.ensureStream(ctx); err != nil {
		return err
	}
	msg := &nats.Msg{Subject: Subject(recipient, e.Type), Data: body, Header: nats.Header{"Content-Type": []string{ContentType}}}
	otel.GetTextMapPropagator().Inject(ctx, headerCarrier(msg.Header))
	if _, err := b.js.PublishMsg(ctx, msg, jetstream.WithMsgID(e.ID.String())); err != nil {
		return fmt.Errorf("natsbridge: publish %s: %w", e.Type, err)
	}
	return nil
}

// recipientOf reads the recipient user id from the payload's top-level field.
// The id is parsed as a UUID, which also keeps '.', '*' and '>' (subject
// syntax) out of the subject.
func recipientOf(payload []byte, field string) (string, error) {
	var m map[string]json.RawMessage
	if err := json.Unmarshal(payload, &m); err != nil {
		return "", fmt.Errorf("payload is not a JSON object: %w", err)
	}
	raw, ok := m[field]
	if !ok {
		return "", fmt.Errorf("payload has no %q field", field)
	}
	var s string
	if err := json.Unmarshal(raw, &s); err != nil {
		return "", fmt.Errorf("payload %q is not a string: %w", field, err)
	}
	id, err := ids.Parse(s)
	if err != nil {
		return "", fmt.Errorf("payload %q is not a user id: %w", field, err)
	}
	return id.String(), nil
}

type headerCarrier nats.Header

var _ propagation.TextMapCarrier = headerCarrier(nil)

func (h headerCarrier) Get(k string) string { return nats.Header(h).Get(k) }
func (h headerCarrier) Set(k, v string)     { nats.Header(h).Set(k, v) }
func (h headerCarrier) Keys() []string {
	keys := make([]string, 0, len(h))
	for k := range h {
		keys = append(keys, k)
	}
	return keys
}
