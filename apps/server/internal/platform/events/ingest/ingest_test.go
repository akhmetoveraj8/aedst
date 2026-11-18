package ingest_test

import (
	"context"
	"errors"
	"net/http"
	"net/http/httptest"
	"sync"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	eventsv1connect "github.com/aedst/server/gen/go/aedst/events/v1/eventsv1connect"
	"github.com/aedst/server/internal/platform/events"
	"github.com/aedst/server/internal/platform/events/ingest"
	"github.com/aedst/server/internal/platform/modulekit"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// fakeRiver stands in for the consumer service's River client: it dedupes on
// (consumer, event id) like the real unique key.
type fakeRiver struct {
	mu   sync.Mutex
	seen map[string]bool
	got  []events.DeliveryArgs
	err  error
}

func (f *fakeRiver) InsertMany(_ context.Context, p []river.InsertManyParams) ([]*rivertype.JobInsertResult, error) {
	f.mu.Lock()
	defer f.mu.Unlock()
	if f.err != nil {
		return nil, f.err
	}
	d := p[0].Args.(events.DeliveryArgs)
	key := d.Consumer + "/" + d.EventID
	if f.seen == nil {
		f.seen = map[string]bool{}
	}
	dup := f.seen[key]
	f.seen[key] = true
	if !dup {
		f.got = append(f.got, d)
	}
	return []*rivertype.JobInsertResult{{UniqueSkippedAsDuplicate: dup}}, nil
}

type fixture struct {
	client *ingest.Client
	river  *fakeRiver
	auth   func() string // last Authorization header seen by the server
}

func newFixture(t *testing.T, token ingest.TokenSource) fixture {
	t.Helper()
	reg := events.NewRegistry()
	reg.Subscribe("tasks.v1.TaskCompleted", "notifications.task_completed", func(context.Context, events.Event) error { return nil })
	fr := &fakeRiver{}

	mux := http.NewServeMux()
	mt := modulekit.NewMounter(mux, nil, nil, 320<<10, true)
	modulekit.Mount(mt, eventsv1connect.RegisterEventIngestServiceHandler, eventsv1connect.EventIngestServiceHandler(ingest.NewHandler(reg, fr)), 320<<10)
	var mu sync.Mutex
	var last string
	srv := httptest.NewServer(http.HandlerFunc(func(w http.ResponseWriter, r *http.Request) {
		mu.Lock()
		last = r.Header.Get("Authorization")
		mu.Unlock()
		mux.ServeHTTP(w, r)
	}))
	t.Cleanup(srv.Close)

	c, err := ingest.NewClient(map[string]string{"notifications": srv.URL}, token)
	if err != nil {
		t.Fatal(err)
	}
	c.WithTarget(func(unit, url string) modulekit.RemoteTarget {
		return modulekit.RemoteTarget{Name: "events-" + unit, BaseURL: url, HTTPClient: srv.Client()}
	})
	return fixture{client: c, river: fr, auth: func() string { mu.Lock(); defer mu.Unlock(); return last }}
}

func delivery() events.DeliveryArgs {
	return events.DeliveryArgs{
		Consumer: "notifications.task_completed", EventID: ids.New().String(), EventType: "tasks.v1.TaskCompleted", EventVersion: 1,
		OccurredAt: time.Now().UTC().Truncate(time.Millisecond), PartitionKey: ids.New().String(), Traceparent: "", Payload: []byte(`{"user_id":"u"}`),
	}
}

func staticToken(string) ingest.TokenSource {
	return func(context.Context) (string, error) { return "svc-token", nil }
}

func TestNewClientNeedsAnIdentity(t *testing.T) {
	if _, err := ingest.NewClient(map[string]string{"x": "https://x"}, nil); err == nil {
		t.Fatal("forwarding without a service identity must fail at startup")
	}
}

func TestForwardDeliversOnceAndIsIdempotent(t *testing.T) {
	f := newFixture(t, staticToken(""))
	d := delivery()
	for range 2 { // the producer retries after a lost response
		if err := f.client.Forward(t.Context(), "notifications", d); err != nil {
			t.Fatalf("Forward: %v", err)
		}
	}
	if len(f.river.got) != 1 {
		t.Fatalf("consumer service holds %d deliveries, want exactly 1", len(f.river.got))
	}
	got := f.river.got[0]
	if got.Consumer != d.Consumer || got.EventID != d.EventID || got.PartitionKey != d.PartitionKey ||
		!got.OccurredAt.Equal(d.OccurredAt) || string(got.Payload) != string(d.Payload) || got.EventVersion != 1 {
		t.Fatalf("delivery changed on the wire: %+v vs %+v", got, d)
	}
	if f.auth() != "Bearer svc-token" {
		t.Fatalf("Authorization = %q, want the service identity's token", f.auth())
	}
}

func TestForwardRejections(t *testing.T) {
	f := newFixture(t, staticToken(""))
	cases := []struct {
		name string
		edit func(*events.DeliveryArgs)
		kind sharederrors.Kind
	}{
		{"unknown consumer", func(d *events.DeliveryArgs) { d.Consumer = "nobody.here" }, sharederrors.KindNotFound},
		{"event type the consumer does not subscribe to", func(d *events.DeliveryArgs) { d.EventType = "other.v1.Thing" }, sharederrors.KindValidation},
		{"malformed event id", func(d *events.DeliveryArgs) { d.EventID = "not-a-uuid" }, sharederrors.KindValidation},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			d := delivery()
			c.edit(&d)
			err := f.client.Forward(t.Context(), "notifications", d)
			var se *sharederrors.Error
			if !errors.As(err, &se) || se.Kind != c.kind {
				t.Fatalf("err = %v, want kind %v (permanent, so the producer cancels instead of retrying)", err, c.kind)
			}
		})
	}
	if len(f.river.got) != 0 {
		t.Fatal("a rejected delivery must not be inserted")
	}
}

func TestForwardUnknownUnitAndTokenFailure(t *testing.T) {
	f := newFixture(t, staticToken(""))
	if err := f.client.Forward(t.Context(), "elsewhere", delivery()); err == nil {
		t.Fatal("a unit with no forward URL must fail")
	}
	failing, err := ingest.NewClient(map[string]string{"notifications": "http://127.0.0.1:1"}, func(context.Context) (string, error) { return "", errors.New("idp down") })
	if err != nil {
		t.Fatal(err)
	}
	if err := failing.Forward(t.Context(), "notifications", delivery()); err == nil {
		t.Fatal("no token, no call: the forward must fail and be retried")
	}
}
