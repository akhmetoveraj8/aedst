package natsbridge_test

import (
	"bytes"
	"context"
	"encoding/json"
	"errors"
	"os"
	"strings"
	"testing"
	"time"

	"github.com/nats-io/nats-server/v2/server"
	"github.com/nats-io/nats.go"
	"github.com/nats-io/nats.go/jetstream"
	"github.com/riverqueue/river"

	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/natsbridge"
	"github.com/aedst/server/internal/shared/ids"
)

const recipient = "0190f3a2-7b1c-7d4e-8a21-5c6d7e8f9a0c"

func startServer(t *testing.T) string {
	t.Helper()
	s, err := server.NewServer(&server.Options{Port: -1, JetStream: true, StoreDir: t.TempDir(), NoLog: true, NoSigs: true})
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
	var got natsbridge.Envelope
	if err := json.Unmarshal(msg.Data, &got); err != nil {
		t.Fatal(err)
	}
	if got.ID != e.ID.String() || got.Type != e.Type || got.PartitionKey != e.PartitionKey.String() || !bytes.Equal(got.Payload, e.Payload) {
		t.Fatalf("envelope = %+v, want the event unchanged", got)
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

// TestEnvelopeMatchesGoldenFixture pins the frame format. The Rust gateway
// parses the very same file (apps/gateway/tests/envelope.rs), so a change on
// either side fails both test suites.
func TestEnvelopeMatchesGoldenFixture(t *testing.T) {
	want, err := os.ReadFile("testdata/envelope.v1.json")
	if err != nil {
		t.Fatal(err)
	}
	var env natsbridge.Envelope
	dec := json.NewDecoder(bytes.NewReader(want))
	dec.DisallowUnknownFields()
	if err := dec.Decode(&env); err != nil {
		t.Fatal(err)
	}
	got, err := json.MarshalIndent(env, "", "  ")
	if err != nil {
		t.Fatal(err)
	}
	if strings.TrimSpace(string(got)) != strings.TrimSpace(string(want)) {
		t.Fatalf("envelope changed:\n--- fixture\n%s\n--- encoded\n%s", want, got)
	}
}

// TestUserIDVectors pins ids.FromExternal(issuer, sub) for the Rust gateway,
// which must derive the same owner id from a token's iss/sub to route events
// (apps/gateway/tests/user_id.rs reads this same file).
func TestUserIDVectors(t *testing.T) {
	raw, err := os.ReadFile("testdata/user_id_vectors.json")
	if err != nil {
		t.Fatal(err)
	}
	var vectors []struct {
		Issuer  string `json:"issuer"`
		Subject string `json:"subject"`
		UserID  string `json:"user_id"`
	}
	if err := json.Unmarshal(raw, &vectors); err != nil {
		t.Fatal(err)
	}
	for _, v := range vectors {
		if got := ids.FromExternal(v.Issuer, v.Subject).String(); got != v.UserID {
			t.Errorf("FromExternal(%q, %q) = %s, fixture says %s", v.Issuer, v.Subject, got, v.UserID)
		}
	}
}
