package webhooks

import (
	"context"
	"errors"
	"fmt"
	"strings"

	"github.com/riverqueue/river"
)

// Result is how one attempt ended.
type Result string

const (
	// ResultDelivered: the receiver answered 2xx.
	ResultDelivered Result = "delivered"
	// ResultRetrying: the attempt failed and River will try again.
	ResultRetrying Result = "retrying"
	// ResultRejected: the receiver answered "do not retry" (a permanent 4xx).
	ResultRejected Result = "rejected"
	// ResultExhausted: the attempt failed and it was the last one.
	ResultExhausted Result = "exhausted"
	// ResultCancelled: nothing was sent (endpoint deleted or disabled, a URL
	// or address that may not be called, a secret that cannot sign).
	ResultCancelled Result = "cancelled"
)

// maxErrorLen bounds the error text handed to a Recorder.
const maxErrorLen = 500

// Attempt is the outcome of one run of the delivery job.
type Attempt struct {
	EndpointID string
	EventID    string
	Result     Result
	// StatusCode is the receiver's HTTP status, 0 when it did not answer.
	StatusCode int
	// Error says why the attempt did not succeed (empty when delivered), at
	// most 500 bytes. It never contains the signing secret: no error of this
	// package is built from it.
	Error string
}

// Sent reports whether a request left for the receiver in this attempt.
func (a Attempt) Sent() bool { return a.Result != ResultCancelled }

// Recorder is told how every attempt ended (the delivery log). An error from it
// makes River retry the job, so a delivery whose outcome could not be stored is
// sent again: delivery stays at-least-once and the log never claims less than
// what happened.
type Recorder interface {
	RecordAttempt(ctx context.Context, attempt Attempt) error
}

// WithRecorder makes the worker report every attempt to r.
func (w *Worker) WithRecorder(r Recorder) *Worker {
	w.recorder = r
	return w
}

// resultOf classifies the outcome of attempt() for a job on its attempt-th run.
func resultOf(err error, status, attempt, maxAttempts int) Result {
	var cancelled *river.JobCancelError
	switch {
	case err == nil:
		return ResultDelivered
	case errors.As(err, &cancelled) && status != 0:
		return ResultRejected
	case cancelled != nil:
		return ResultCancelled
	case attempt >= maxAttempts:
		return ResultExhausted
	default:
		return ResultRetrying
	}
}

// record reports the outcome and returns what River must see: the delivery's own
// outcome, or the recorder's error when the outcome could not be stored and the
// job can still run again.
func (w *Worker) record(ctx context.Context, job *river.Job[DeliveryArgs], status int, deliveryErr error) error {
	if w.recorder == nil {
		return deliveryErr
	}
	attempt := Attempt{
		EndpointID: job.Args.EndpointID,
		EventID:    job.Args.EventID,
		Result:     resultOf(deliveryErr, status, job.Attempt, job.MaxAttempts),
		StatusCode: status,
	}
	if deliveryErr != nil {
		attempt.Error = truncate(deliveryErr.Error(), maxErrorLen)
	}
	if err := w.recorder.RecordAttempt(ctx, attempt); err != nil {
		if attempt.Result == ResultExhausted {
			return deliveryErr // no run is left to record it in
		}
		return fmt.Errorf("webhooks: record attempt: %w", err)
	}
	return deliveryErr
}

// truncate cuts s to at most limit bytes; a UTF-8 sequence split by the cut is dropped.
func truncate(s string, limit int) string {
	if len(s) <= limit {
		return s
	}
	return strings.ToValidUTF8(s[:limit], "")
}
