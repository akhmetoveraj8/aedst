package natsbridge_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"flag"
	"os"
	"testing"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/riverqueue/river"
	"google.golang.org/protobuf/proto"

	eventsv1 "github.com/aedst/server/gen/go/aedst/events/v1"
	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/natsbridge"
	"github.com/aedst/server/internal/shared/ids"
)

const recipient = "0190f3a2-7b1c-7d4e-8a21-5c6d7e8f9a0c"

func startServer(t *testing.T) string {
	t.Helper()
	// Loopback, not the default 0.0.0.0: ClientURL then advertises an address
	// every client can dial (the Rust gateway cannot connect to 0.0.0.0 on Windows).
	s, err := server.NewServer(&server.Options{Host: "127.0.0.1", Port: -1, JetStream: true, StoreDir: t.TempDir(), NoLog: true, NoSigs: true})
	if err != nil {
		t.Fatalf("nats server: %v", err)
	}
	go s.Start()
	if !s.ReadyForConnections(10 * time.Second) {
		t.Fatal("nats server not ready")
	}
	t.Cleanup(s.Shutdown)
	return s.ClientURL()
}

func event(t *testing.T, payload string) events.Event {
	t.Helper()
	return events.Event{
		ID: ids.New(), Type: "tasks.v1.TaskCompleted", Version: 1,
		OccurredAt: time.Date(2026, 3, 1, 10, 0, 0, 0, time.UTC), PartitionKey: ids.New(),
		Payload: []byte(payload),
	}
}

func TestForwardPublishesEnvelopeOnUserSubjectAndDeduplicates(t *testing.T) {
	url := startServer(t)
	b, err := natsbridge.Connect(natsbridge.Config{URL: url})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()

	e := event(t, `{"task_id":"x","user_id":"`+recipient+`"}`)
	ctx := context.Background()
	for range 2 { // a River retry publishes the same event again
		if err := b.Forward(ctx, e); err != nil {
			t.Fatalf("Forward: %v", err)
		}
	}

	nc, err := nats.Connect(url)
	if err != nil {
		t.Fatal(err)
	}
	defer nc.Close()
	js, _ := jetstream.New(nc)
	stream, err := js.Stream(ctx, "AEDST_EVENTS")
	if err != nil {
		t.Fatal(err)
	}
	info, _ := stream.Info(ctx)
	if info.State.Msgs != 1 {
		t.Fatalf("stream holds %d messages after a duplicate publish, want 1 (Nats-Msg-Id dedup)", info.State.Msgs)
	}
	msg, err := stream.GetLastMsgForSubject(ctx, natsbridge.Subject(recipient, e.Type))
	if err != nil {
		t.Fatalf("no message on the recipient subject: %v", err)
	}
	if ct := msg.Header.Get("Content-Type"); ct != natsbridge.ContentType {
		t.Fatalf("Content-Type = %q, want %q", ct, natsbridge.ContentType)
	}
	var got eventsv1.EventEnvelope
	if err := proto.Unmarshal(msg.Data, &got); err != nil {
		t.Fatalf("body is not an EventEnvelope: %v", err)
	}
	if got.GetId() != e.ID.String() || got.GetType() != e.Type || got.GetVersion() != e.Version ||
		got.GetPartitionKey() != e.PartitionKey.String() || !got.GetOccurredAt().AsTime().Equal(e.OccurredAt) ||
		!bytes.Equal(got.GetPayload(), e.Payload) {
		t.Fatalf("envelope = %v, want the event unchanged", &got)
	}
}

func TestForwardCancelsAnUnroutableEvent(t *testing.T) {
	b, err := natsbridge.Connect(natsbridge.Config{URL: startServer(t)})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	for name, payload := range map[string]string{
		"no field":        `{"task_id":"x"}`,
		"not a uuid":      `{"user_id":"a.b.>"}`,
		"not an object":   `[1]`,
		"wrong type":      `{"user_id":7}`,
		"subject syntax":  `{"user_id":"*"}`,
		"empty recipient": `{"user_id":""}`,
	} {
		err := b.Forward(context.Background(), event(t, payload))
		if _, ok := errors.AsType[*river.JobCancelError](err); !ok {
			t.Errorf("%s: err = %v, want river.JobCancel (a retry can never succeed)", name, err)
		}
	}
}

func TestForwardFailsRetryablyWhenBrokerIsDown(t *testing.T) {
	b, err := natsbridge.Connect(natsbridge.Config{URL: "nats://127.0.0.1:1", PublishTimeout: 300 * time.Millisecond})
	if err != nil {
		t.Fatalf("Connect must not fail while the broker is down: %v", err)
	}
	defer b.Close()
	err = b.Forward(context.Background(), event(t, `{"user_id":"`+recipient+`"}`))
	if err == nil {
		t.Fatal("Forward succeeded without a broker")
	}
	if _, ok := errors.AsType[*river.JobCancelError](err); ok {
		t.Fatalf("a broker outage must be retried, not cancelled: %v", err)
	}
}

func TestSubscribeRegistersOneConsumerPerType(t *testing.T) {
	b, err := natsbridge.Connect(natsbridge.Config{URL: "nats://127.0.0.1:1"})
	if err != nil {
		t.Fatal(err)
	}
	defer b.Close()
	r := events.NewRegistry()
	b.Subscribe(r, []string{"tasks.v1.TaskCompleted", "tasks.v1.TaskCreated"})
	if got := r.Consumers("tasks.v1.TaskCompleted"); len(got) != 1 || got[0] != natsbridge.ConsumerPrefix+"tasks.v1.TaskCompleted" {
		t.Fatalf("consumers = %v", got)
	}
}

// update rewrites testdata/envelope.v1.binpb from testdata/frame.v1.json:
// go test ./internal/platform/natsbridge -run TestEnvelopeMatchesGoldenFixture -update
var update = flag.Bool("update", false, "rewrite testdata/envelope.v1.binpb")

// goldenFrame is the client frame the gateway renders from an envelope
// (testdata/frame.v1.json): the envelope's fields with the payload inlined.
type goldenFrame struct {
	ID           string          `json:"id"`
	Type         string          `json:"type"`
	Version      uint32          `json:"version"`
	OccurredAt   time.Time       `json:"occurred_at"`
	PartitionKey string          `json:"partition_key"`
	Payload      json.RawMessage `json:"payload"`
}

// TestEnvelopeMatchesGoldenFixture pins the wire contract with the Rust
// gateway from both ends: testdata/envelope.v1.binpb is the Protobuf body of
// the event described by testdata/frame.v1.json. Here the Go encoding of that
// event must decode to the same message; apps/gateway/tests/envelope.rs decodes
// the same .binpb and must render exactly frame.v1.json for the client.
func TestEnvelopeMatchesGoldenFixture(t *testing.T) {
	raw, err := os.ReadFile("testdata/frame.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var frame goldenFrame
	dec := json.NewDecoder(bytes.NewReader(raw))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&frame); err != nil {
		t.Fatal(err)
	}
	var compact bytes.Buffer
	if err := json.Compact(&compact, frame.Payload); err != nil {
		t.Fatal(err)
	}
	want := natsbridge.NewEnvelope(events.Event{
		ID: ids.MustParse(frame.ID), Type: frame.Type, Version: frame.Version,
		OccurredAt: frame.OccurredAt, PartitionKey: ids.MustParse(frame.PartitionKey), Payload: compact.Bytes(),
	})
	if *update {
		body, err := proto.MarshalOptions{Deterministic: true}.Marshal(want)
		if err != nil {
			t.Fatal(err)
		}
		if err := os.WriteFile("testdata/envelope.v1.binpb", body, 0o600); err != nil {
			t.Fatal(err)
		}
	}
	body, err := os.ReadFile("testdata/envelope.v1.binpb")
	if err != nil {
		t.Fatal(err)
	}
	var got eventsv1.EventEnvelope
	if err := proto.Unmarshal(body, &got); err != nil {
		t.Fatal(err)
	}
	if !proto.Equal(&got, want) {
		t.Fatalf("envelope changed:\n--- fixture\n%v\n--- encoded from frame.v1.json\n%v", &got, want)
	}
}
