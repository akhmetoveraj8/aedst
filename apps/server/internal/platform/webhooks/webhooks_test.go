package webhooks_test

import (
	"context"
	"encoding/json"
	"errors"
	"io"
	"net/http"
	"net/http/httptest"
	"net/netip"
	"strings"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/platform/webhooks"
)

// A Standard Webhooks secret: "whsec_" + base64 of the key bytes.
const (
	testSecret  = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"
	otherSecret = "whsec_c2Vjb25kLXNlY3JldC1rZXktYnl0ZXM="
	eventID     = "0192f3c4-7a1e-7b52-9d3e-4c1f8a6b2e10"
)

var testPayload = json.RawMessage(`{"task_id":"t1","title":"Write the release notes"}`)

type store map[string]webhooks.Endpoint

func (s store) GetEndpoint(_ context.Context, id string) (webhooks.Endpoint, bool, error) {
	e, ok := s[id]
	return e, ok, nil
}

type failingStore struct{}

func (failingStore) GetEndpoint(context.Context, string) (webhooks.Endpoint, bool, error) {
	return webhooks.Endpoint{}, false, errors.New("database down")
}

// receiver records what it was sent and answers with status.
type receiver struct {
	status int
	header http.Header
	body   []byte
	calls  int
}

func (r *receiver) Do(req *http.Request) (*http.Response, error) {
	r.calls++
	r.header = req.Header.Clone()
	r.body, _ = io.ReadAll(req.Body)
	rec := httptest.NewRecorder()
	rec.WriteHeader(r.status)
	return rec.Result(), nil
}

func job(args webhooks.DeliveryArgs) *river.Job[webhooks.DeliveryArgs] {
	return &river.Job[webhooks.DeliveryArgs]{JobRow: &rivertype.JobRow{Attempt: 1, MaxAttempts: 25}, Args: args}
}

func delivery() webhooks.DeliveryArgs {
	return webhooks.DeliveryArgs{EndpointID: "e1", EventID: eventID, EventType: "tasks.v1.TaskCompleted", Payload: testPayload}
}

func isCancel(err error) bool {
	var cancel *rivertype.JobCancelError
	return errors.As(err, &cancel)
}

func TestWorker_SignedDeliveryVerifiesAndCarriesTheEventID(t *testing.T) {
	now := time.Now()
	rcv := &receiver{status: http.StatusNoContent}
	endpoints := store{"e1": {ID: "e1", URL: "https://hooks.example.com/aedst", Secret: testSecret}}
	worker := webhooks.NewWorker(endpoints, rcv, func() time.Time { return now })

	if err := worker.Work(context.Background(), job(delivery())); err != nil {
		t.Fatalf("Work: %v", err)
	}
	if string(rcv.body) != string(testPayload) {
		t.Fatalf("body = %s, want the payload byte for byte", rcv.body)
	}
	if got := rcv.header.Get("Webhook-Id"); got != eventID {
		t.Errorf("webhook-id = %q, want the event id (the receiver's idempotency key)", got)
	}
	if rcv.header.Get("Webhook-Event-Type") != "tasks.v1.TaskCompleted" || rcv.header.Get("Content-Type") != "application/json" {
		t.Errorf("headers = %v", rcv.header)
	}
	if err := webhooks.Verify(testSecret, rcv.body, rcv.header); err != nil {
		t.Fatalf("the receiver cannot verify a genuine delivery: %v", err)
	}

	// What a receiver must reject.
	if err := webhooks.Verify(otherSecret, rcv.body, rcv.header); err == nil {
		t.Error("verified with the wrong secret")
	}
	if err := webhooks.Verify(testSecret, append([]byte(" "), rcv.body...), rcv.header); err == nil {
		t.Error("verified a tampered body")
	}
	replayedID := rcv.header.Clone()
	replayedID.Set("Webhook-Id", "another-id")
	if err := webhooks.Verify(testSecret, rcv.body, replayedID); err == nil {
		t.Error("verified with a swapped webhook-id: the id is not covered by the signature")
	}

	// A retry is the same message (same id) signed with a fresh timestamp.
	later := now.Add(time.Minute)
	worker = webhooks.NewWorker(endpoints, rcv, func() time.Time { return later })
	first := rcv.header.Get("Webhook-Signature")
	if err := worker.Work(context.Background(), job(delivery())); err != nil {
		t.Fatal(err)
	}
	if rcv.header.Get("Webhook-Id") != eventID || rcv.header.Get("Webhook-Signature") == first {
		t.Error("a retry must keep the id and sign the new timestamp")
	}
}

func TestVerify_RejectsDeliveriesOutsideTheReplayWindow(t *testing.T) {
	endpoint := webhooks.Endpoint{ID: "e1", URL: "https://hooks.example.com/x", Secret: testSecret}
	for name, at := range map[string]time.Time{
		"too old": time.Now().Add(-webhooks.ReplayWindow - time.Minute),
		"too new": time.Now().Add(webhooks.ReplayWindow + time.Minute),
	} {
		req, err := webhooks.NewRequest(context.Background(), endpoint, delivery(), at)
		if err != nil {
			t.Fatal(err)
		}
		if err := webhooks.Verify(testSecret, testPayload, req.Header); err == nil {
			t.Errorf("%s: a delivery outside the replay window verified", name)
		}
	}
}

func TestWorker_RetriesTransientAndCancelsPermanentOutcomes(t *testing.T) {
	now := time.Now
	good := store{"e1": {ID: "e1", URL: "https://hooks.example.com/x", Secret: testSecret}}

	for status, want := range map[int]string{
		http.StatusOK: "done", http.StatusAccepted: "done",
		http.StatusInternalServerError: "retry", http.StatusBadGateway: "retry", http.StatusServiceUnavailable: "retry",
		http.StatusTooManyRequests: "retry", http.StatusRequestTimeout: "retry", http.StatusFound: "retry",
		http.StatusBadRequest: "cancel", http.StatusUnauthorized: "cancel", http.StatusNotFound: "cancel", http.StatusGone: "cancel",
	} {
		err := webhooks.NewWorker(good, &receiver{status: status}, now).Work(context.Background(), job(delivery()))
		got := "done"
		switch {
		case isCancel(err):
			got = "cancel"
		case err != nil:
			got = "retry"
		}
		if got != want {
			t.Errorf("receiver answered %d: %s (%v), want %s", status, got, err, want)
		}
	}

	tests := []struct {
		name      string
		endpoints webhooks.EndpointStore
		cancel    bool
	}{
		{"endpoint deleted", store{}, true},
		{"endpoint disabled", store{"e1": {ID: "e1", URL: "https://hooks.example.com/x", Secret: testSecret, Disabled: true}}, true},
		{"plain http URL", store{"e1": {ID: "e1", URL: "http://hooks.example.com/x", Secret: testSecret}}, true},
		{"unusable secret", store{"e1": {ID: "e1", URL: "https://hooks.example.com/x", Secret: "whsec_not base64!"}}, true},
		{"registry unavailable is retried", failingStore{}, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rcv := &receiver{status: http.StatusOK}
			err := webhooks.NewWorker(tt.endpoints, rcv, now).Work(context.Background(), job(delivery()))
			if err == nil || isCancel(err) != tt.cancel {
				t.Fatalf("err = %v, cancelled = %v, want cancelled = %v", err, isCancel(err), tt.cancel)
			}
			if rcv.calls != 0 {
				t.Fatal("a request was sent")
			}
		})
	}
}

func TestDeliveryArgs_KindAndUniqueness(t *testing.T) {
	args := delivery()
	if args.Kind() != "platform.webhook_delivery" {
		t.Errorf("kind = %q: it is persisted in job rows", args.Kind())
	}
	opts := args.InsertOpts()
	if !opts.UniqueOpts.ByArgs || opts.MaxAttempts < 10 {
		t.Errorf("insert opts = %+v, want unique by args (endpoint, event id) and a long retry tail", opts)
	}
	raw, _ := json.Marshal(args)
	if strings.Contains(string(raw), "whsec_") {
		t.Error("the secret must never be in job args")
	}
}

func TestValidateURL(t *testing.T) {
	for raw, ok := range map[string]bool{
		"https://hooks.example.com/aedst?x=1": true,
		"http://hooks.example.com/aedst":      false,
		"https://user:pass@hooks.example.com": false,
		"https:///path":                       false,
		"ftp://hooks.example.com":             false,
		"https://hooks.example.com/#frag":     false,
		"://":                                 false,
	} {
		if err := webhooks.ValidateURL(raw); (err == nil) != ok {
			t.Errorf("ValidateURL(%q) = %v, want ok = %v", raw, err, ok)
		}
	}
}

func TestIsPublicAddress(t *testing.T) {
	for addr, public := range map[string]bool{
		"93.184.216.34": true, "2606:2800:220:1:248:1893:25c8:1946": true,
		"127.0.0.1": false, "::1": false, "10.1.2.3": false, "172.16.0.1": false, "192.168.1.1": false,
		"169.254.169.254": false, "100.64.0.1": false, "0.0.0.0": false, "::": false, "fd00::1": false,
		"fe80::1": false, "224.0.0.1": false, "255.255.255.255": false, "::ffff:127.0.0.1": false,
		"::ffff:10.0.0.1": false, "198.18.0.1": false, "64:ff9b::7f00:1": false,
	} {
		if got := webhooks.IsPublicAddress(netip.MustParseAddr(addr)); got != public {
			t.Errorf("IsPublicAddress(%s) = %v, want %v", addr, got, public)
		}
	}
}

// The production client refuses to connect to a non-public address (here the
// test server on loopback) even though the URL passed validation, does not
// follow redirects, and honours the host allowlist before dialing.
func TestHTTPClient_RefusesInternalDestinations(t *testing.T) {
	hits := 0
	internal := httptest.NewTLSServer(http.HandlerFunc(func(http.ResponseWriter, *http.Request) { hits++ }))
	t.Cleanup(internal.Close)

	client := webhooks.NewHTTPClient(webhooks.ClientConfig{})
	req, _ := http.NewRequestWithContext(context.Background(), http.MethodPost, internal.URL, strings.NewReader("{}"))
	resp, err := client.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
	if !errors.Is(err, webhooks.ErrForbiddenAddress) || hits != 0 {
		t.Fatalf("delivery to loopback: err = %v, hits = %d; want it refused before connecting", err, hits)
	}

	endpoints := store{"e1": {ID: "e1", URL: internal.URL, Secret: testSecret}}
	err = webhooks.NewWorker(endpoints, client, time.Now).Work(context.Background(), job(delivery()))
	if !isCancel(err) || hits != 0 {
		t.Fatalf("worker against an internal address: err = %v, want the job cancelled", err)
	}

	allowlisted := webhooks.NewHTTPClient(webhooks.ClientConfig{AllowedHosts: []string{"hooks.example.com", ".partner.example"}})
	req, _ = http.NewRequestWithContext(context.Background(), http.MethodPost, "https://evil.example.org/x", strings.NewReader("{}"))
	resp, err = allowlisted.Do(req)
	if err == nil {
		_ = resp.Body.Close()
	}
	if !errors.Is(err, webhooks.ErrForbiddenAddress) {
		t.Fatalf("host outside the allowlist: err = %v", err)
	}
}
