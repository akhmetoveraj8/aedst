package webhooks_test

import (
	"context"
	"errors"
	"net/http"
	"strings"
	"testing"
	"time"

	"github.com/riverqueue/river"
	"github.com/riverqueue/river/rivertype"

	"github.com/aedst/server/internal/platform/webhooks"
)

type recorder struct {
	attempts []webhooks.Attempt
	err      error
}

func (r *recorder) RecordAttempt(_ context.Context, a webhooks.Attempt) error {
	r.attempts = append(r.attempts, a)
	return r.err
}

// failingDoer never gets an answer from the receiver.
type failingDoer struct{ err error }

func (f failingDoer) Do(*http.Request) (*http.Response, error) { return nil, f.err }

func jobOnAttempt(attempt int) *river.Job[webhooks.DeliveryArgs] {
	return &river.Job[webhooks.DeliveryArgs]{JobRow: &rivertype.JobRow{Attempt: attempt, MaxAttempts: 25}, Args: delivery()}
}

func TestWorker_RecordsTheOutcomeOfEveryAttempt(t *testing.T) {
	now := func() time.Time { return time.Unix(1_795_253_400, 0) }
	good := store{"e1": {ID: "e1", URL: "https://hooks.example.com/in", Secret: testSecret}}
	tests := []struct {
		name       string
		endpoints  store
		client     webhooks.Doer
		attempt    int
		want       webhooks.Result
		wantStatus int
		wantSent   bool
		wantCancel bool
		wantErr    bool
	}{
		{"2xx is delivered", good, &receiver{status: http.StatusNoContent}, 1, webhooks.ResultDelivered, 204, true, false, false},
		{"5xx is retried", good, &receiver{status: http.StatusBadGateway}, 3, webhooks.ResultRetrying, 502, true, false, true},
		{"429 is retried", good, &receiver{status: http.StatusTooManyRequests}, 1, webhooks.ResultRetrying, 429, true, false, true},
		{"5xx on the last attempt is exhausted", good, &receiver{status: http.StatusInternalServerError}, 25, webhooks.ResultExhausted, 500, true, false, true},
		{"permanent 4xx is rejected", good, &receiver{status: http.StatusGone}, 1, webhooks.ResultRejected, 410, true, true, false},
		{"no answer is retried with status 0", good, failingDoer{errors.New("connection reset")}, 2, webhooks.ResultRetrying, 0, true, false, true},
		{"no answer on the last attempt is exhausted", good, failingDoer{errors.New("connection reset")}, 25, webhooks.ResultExhausted, 0, true, false, true},
		{"forbidden address is cancelled, nothing sent", good, failingDoer{webhooks.ErrForbiddenAddress}, 1, webhooks.ResultCancelled, 0, false, true, false},
		{"deleted endpoint is cancelled", store{}, &receiver{status: 204}, 1, webhooks.ResultCancelled, 0, false, true, false},
		{"disabled endpoint is cancelled", store{"e1": {ID: "e1", URL: "https://hooks.example.com/in", Secret: testSecret, Disabled: true}}, &receiver{status: 204}, 1, webhooks.ResultCancelled, 0, false, true, false},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			rec := &recorder{}
			err := webhooks.NewWorker(tt.endpoints, tt.client, now).WithRecorder(rec).Work(context.Background(), jobOnAttempt(tt.attempt))
			if isCancel(err) != tt.wantCancel || (err != nil && !isCancel(err)) != tt.wantErr {
				t.Fatalf("Work() = %v, want cancel=%v retry=%v", err, tt.wantCancel, tt.wantErr)
			}
			if len(rec.attempts) != 1 {
				t.Fatalf("%d attempts recorded, want exactly 1", len(rec.attempts))
			}
			a := rec.attempts[0]
			if a.Result != tt.want || a.StatusCode != tt.wantStatus || a.Sent() != tt.wantSent {
				t.Errorf("attempt = %+v (sent=%v), want %s with status %d sent=%v", a, a.Sent(), tt.want, tt.wantStatus, tt.wantSent)
			}
			if a.EndpointID != "e1" || a.EventID != delivery().EventID {
				t.Errorf("attempt ids = %s / %s, want the job's", a.EndpointID, a.EventID)
			}
			if (a.Error == "") != (tt.want == webhooks.ResultDelivered) {
				t.Errorf("error text = %q for result %s", a.Error, a.Result)
			}
			if strings.Contains(a.Error, testSecret) || strings.Contains(a.Error, "whsec_") {
				t.Errorf("the recorded error contains the signing secret: %q", a.Error)
			}
		})
	}
}

func TestWorker_RecorderFailureMakesRiverRetry(t *testing.T) {
	now := func() time.Time { return time.Unix(1_795_253_400, 0) }
	good := store{"e1": {ID: "e1", URL: "https://hooks.example.com/in", Secret: testSecret}}
	rec := &recorder{err: errors.New("db down")}

	// Delivered but not recorded: the job fails so the outcome is recorded on a later run.
	err := webhooks.NewWorker(good, &receiver{status: 204}, now).WithRecorder(rec).Work(context.Background(), jobOnAttempt(1))
	if err == nil || isCancel(err) {
		t.Fatalf("Work() = %v, want a retryable error when the outcome could not be stored", err)
	}
	// Rejected but not recorded: retried too, instead of cancelling with a stale log.
	err = webhooks.NewWorker(good, &receiver{status: http.StatusGone}, now).WithRecorder(rec).Work(context.Background(), jobOnAttempt(1))
	if err == nil || isCancel(err) {
		t.Fatalf("Work() = %v, want a retryable error", err)
	}
	// The last attempt has no later run: River sees the delivery's own failure.
	err = webhooks.NewWorker(good, &receiver{status: 500}, now).WithRecorder(rec).Work(context.Background(), jobOnAttempt(25))
	if err == nil || strings.Contains(err.Error(), "record attempt") {
		t.Fatalf("Work() = %v, want the delivery error on the last attempt", err)
	}
}

func TestWorker_LongErrorsAreTruncated(t *testing.T) {
	now := func() time.Time { return time.Unix(1_795_253_400, 0) }
	good := store{"e1": {ID: "e1", URL: "https://hooks.example.com/in", Secret: testSecret}}
	rec := &recorder{}
	_ = webhooks.NewWorker(good, failingDoer{errors.New(strings.Repeat("é", 2000))}, now).WithRecorder(rec).Work(context.Background(), jobOnAttempt(1))
	if got := rec.attempts[0].Error; len(got) > 500 || !strings.HasPrefix(got, "webhooks: deliver: ") || strings.ContainsRune(got, '�') {
		t.Fatalf("error text is %d bytes (%q...), want at most 500 valid UTF-8 bytes", len(got), got[:30])
	}
}
