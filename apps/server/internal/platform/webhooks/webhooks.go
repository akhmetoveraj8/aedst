// Package webhooks delivers outbound webhooks: a River job per (endpoint, event)
// that POSTs the event to a third party's URL, signed and timestamped the
// Standard Webhooks way (HMAC-SHA256 over "id.timestamp.body", headers
// webhook-id, webhook-timestamp, webhook-signature), retried by River with
// exponential backoff, idempotent for the receiver through the event id.
//
// Signing and verification are the Standard Webhooks library, never hand-written
// HMAC code; receivers verify with the same library in their own language
// (docs/content/api/webhooks.md).
//
// This package is the delivery job, the signer, the SSRF guard and the
// receiver's verification helper. The endpoint registry, the fan-out that
// inserts DeliveryArgs and the delivery log live in internal/modules/webhooks,
// which registers the worker with an EndpointStore and a Recorder.
package webhooks

import (
	"context"
	"encoding/json"
	"errors"
	"fmt"
	"net/http"
	"net/url"
	"strconv"
	"time"

	"github.com/riverqueue/river"
	standardwebhooks "github.com/standard-webhooks/standard-webhooks/libraries/go"
)

// DeliveryKind is the River job kind. It is persisted in job rows: never rename it.
const DeliveryKind = "platform.webhook_delivery"

const (
	// maxAttempts with River's default backoff (attempt^4 seconds) spreads the
	// retries over roughly three weeks before the delivery is discarded.
	maxAttempts = 25
	// deliveryTimeout bounds one POST: a slow receiver must not hold a River slot.
	deliveryTimeout = 15 * time.Second
	// ReplayWindow is how far a delivery's timestamp may be from the receiver's
	// clock (the library's tolerance). Every attempt is signed with a fresh
	// timestamp, so a retry days later still verifies.
	ReplayWindow = 5 * time.Minute
)

// Endpoint is one registered receiver.
type Endpoint struct {
	ID string
	// URL is the https URL deliveries are POSTed to.
	URL string
	// Secret is the signing secret in the Standard Webhooks form
	// ("whsec_" + base64). It never appears in job args or logs.
	Secret string
	// Disabled endpoints receive nothing; their queued deliveries are cancelled.
	Disabled bool
}

// EndpointStore is the endpoint registry the worker reads. found=false means the
// endpoint was deleted.
type EndpointStore interface {
	GetEndpoint(ctx context.Context, id string) (endpoint Endpoint, found bool, err error)
}

// DeliveryArgs is one delivery of one event to one endpoint. It is unique on
// (endpoint, event id), so inserting it twice for the same event creates one job.
type DeliveryArgs struct {
	EndpointID string `json:"endpoint_id" river:"unique"`
	// EventID is the integration event's id. It is sent as webhook-id: the
	// receiver's idempotency key, identical on every retry.
	EventID   string `json:"event_id" river:"unique"`
	EventType string `json:"event_type"`
	// Payload is the JSON body sent to the receiver, byte for byte.
	Payload json.RawMessage `json:"payload"`
}

// Kind implements river.JobArgs.
func (DeliveryArgs) Kind() string { return DeliveryKind }

// InsertOpts implements river.JobArgsWithInsertOpts.
func (DeliveryArgs) InsertOpts() river.InsertOpts {
	return river.InsertOpts{MaxAttempts: maxAttempts, UniqueOpts: river.UniqueOpts{ByArgs: true}}
}

// Doer is the HTTP client the worker sends with (NewHTTPClient in production).
type Doer interface {
	Do(req *http.Request) (*http.Response, error)
}

// Worker delivers DeliveryArgs.
type Worker struct {
	river.WorkerDefaults[DeliveryArgs]
	endpoints EndpointStore
	client    Doer
	now       func() time.Time
	recorder  Recorder
}

// NewWorker builds the worker. now is the clock (sharedtime.Clock.Now).
func NewWorker(endpoints EndpointStore, client Doer, now func() time.Time) *Worker {
	return &Worker{endpoints: endpoints, client: client, now: now}
}

// Timeout bounds one delivery attempt.
func (w *Worker) Timeout(*river.Job[DeliveryArgs]) time.Duration { return deliveryTimeout }

// Work sends one delivery. A returned error is retried by River with backoff; a
// permanent condition (endpoint gone or disabled, a URL that may not be called,
// the receiver answering "do not retry") cancels the job.
func (w *Worker) Work(ctx context.Context, job *river.Job[DeliveryArgs]) error {
	status, err := w.attempt(ctx, job.Args)
	return w.record(ctx, job, status, err)
}

// attempt sends one delivery and returns the receiver's HTTP status (0 when no
// response was received) with the outcome as River understands it.
func (w *Worker) attempt(ctx context.Context, args DeliveryArgs) (int, error) {
	endpoint, found, err := w.endpoints.GetEndpoint(ctx, args.EndpointID)
	if err != nil {
		return 0, fmt.Errorf("webhooks: load endpoint: %w", err)
	}
	if !found || endpoint.Disabled {
		return 0, river.JobCancel(errors.New("webhooks: endpoint deleted or disabled"))
	}
	if err := ValidateURL(endpoint.URL); err != nil {
		return 0, river.JobCancel(err)
	}
	req, err := NewRequest(ctx, endpoint, args, w.now())
	if err != nil {
		return 0, river.JobCancel(err)
	}
	resp, err := w.client.Do(req)
	if err != nil {
		if errors.Is(err, ErrForbiddenAddress) {
			return 0, river.JobCancel(err)
		}
		return 0, fmt.Errorf("webhooks: deliver: %w", err)
	}
	defer func() { _ = resp.Body.Close() }()
	return resp.StatusCode, classify(resp.StatusCode)
}

// classify maps the receiver's answer: 2xx delivered, a retryable status retried,
// any other 4xx (the receiver rejects this message for good) and 410 cancelled.
// Redirects are not followed (see NewHTTPClient) and count as a failure to retry.
func classify(status int) error {
	switch {
	case status >= 200 && status < 300:
		return nil
	case status == http.StatusRequestTimeout, status == http.StatusTooEarly, status == http.StatusTooManyRequests:
		return fmt.Errorf("webhooks: receiver answered %d", status)
	case status >= 400 && status < 500:
		return river.JobCancel(fmt.Errorf("webhooks: receiver rejected the delivery with %d", status))
	default:
		return fmt.Errorf("webhooks: receiver answered %d", status)
	}
}

// NewRequest builds the signed POST for one attempt at time now.
func NewRequest(ctx context.Context, endpoint Endpoint, args DeliveryArgs, now time.Time) (*http.Request, error) {
	signer, err := standardwebhooks.NewWebhook(endpoint.Secret)
	if err != nil {
		return nil, fmt.Errorf("webhooks: endpoint secret: %w", err)
	}
	signature, err := signer.Sign(args.EventID, now, args.Payload)
	if err != nil {
		return nil, fmt.Errorf("webhooks: sign: %w", err)
	}
	req, err := http.NewRequestWithContext(ctx, http.MethodPost, endpoint.URL, bytesReader(args.Payload))
	if err != nil {
		return nil, fmt.Errorf("webhooks: request: %w", err)
	}
	req.Header.Set("Content-Type", "application/json")
	req.Header.Set("User-Agent", "aedst-webhooks/1")
	req.Header.Set(standardwebhooks.HeaderWebhookID, args.EventID)
	req.Header.Set(standardwebhooks.HeaderWebhookTimestamp, strconv.FormatInt(now.Unix(), 10))
	req.Header.Set(standardwebhooks.HeaderWebhookSignature, signature)
	req.Header.Set("Webhook-Event-Type", args.EventType)
	return req, nil
}

// Verify is the receiver's side, for Go receivers and for tests: it checks the
// signature of payload against the webhook-* headers and that the timestamp is
// within ReplayWindow of the current time. Receivers in other languages use the
// Standard Webhooks library for their language with the same secret.
func Verify(secret string, payload []byte, headers http.Header) error {
	verifier, err := standardwebhooks.NewWebhook(secret)
	if err != nil {
		return fmt.Errorf("webhooks: secret: %w", err)
	}
	if err := verifier.Verify(payload, headers); err != nil {
		return fmt.Errorf("webhooks: verify: %w", err)
	}
	return nil
}

// ValidateURL accepts only an absolute https URL with a host and no credentials.
// It is checked when an endpoint is registered and again before every delivery.
// The address the host resolves to is checked at connect time (NewHTTPClient).
func ValidateURL(raw string) error {
	u, err := url.Parse(raw)
	switch {
	case err != nil:
		return errors.New("webhooks: endpoint URL does not parse")
	case u.Scheme != "https":
		return errors.New("webhooks: endpoint URL must use https")
	case u.Hostname() == "":
		return errors.New("webhooks: endpoint URL has no host")
	case u.User != nil:
		return errors.New("webhooks: endpoint URL must not carry credentials")
	case u.Fragment != "":
		return errors.New("webhooks: endpoint URL must not have a fragment")
	}
	return nil
}
