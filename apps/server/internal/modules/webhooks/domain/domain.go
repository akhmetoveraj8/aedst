// Package domain holds the webhooks module's entities and rules: an Endpoint
// (a third party's receiver), a Delivery (one event for one endpoint) and the
// signing secret format. It depends on the standard library and internal/shared only.
package domain

import (
	"crypto/rand"
	"encoding/base64"
	"net/url"
	"slices"
	"strings"
	"time"
	"unicode/utf8"

	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

// EndpointStatus says whether an endpoint receives deliveries. The values are
// stored in webhooks.endpoints.status (CHECK constraint).
type EndpointStatus string

const (
	EndpointActive   EndpointStatus = "active"
	EndpointDisabled EndpointStatus = "disabled"
)

// DisabledReason says who disabled an endpoint (webhooks.endpoints.disabled_reason).
type DisabledReason string

const (
	DisabledNone DisabledReason = ""
	// DisabledByOperator: DisableEndpoint was called.
	DisabledByOperator DisabledReason = "operator"
	// DisabledByFailures: too many failed deliveries in a row (the dead-letter state).
	DisabledByFailures DisabledReason = "consecutive_failures"
)

// DeliveryStatus is the state of a delivery (webhooks.deliveries.status).
type DeliveryStatus string

const (
	DeliveryPending   DeliveryStatus = "pending"
	DeliveryDelivered DeliveryStatus = "delivered"
	// DeliveryFailed: the receiver rejected it for good, or every retry was used up.
	DeliveryFailed DeliveryStatus = "failed"
	// DeliveryCancelled: not sent (endpoint disabled or deleted, URL not callable).
	DeliveryCancelled DeliveryStatus = "cancelled"
)

const (
	MaxURLLen         = 2048
	MaxDescriptionLen = 500
	MaxEventTypes     = 32
	// secretBytes is the entropy of a signing secret (Standard Webhooks asks for
	// 24 to 64 bytes).
	secretBytes  = 32
	secretPrefix = "whsec_"
)

// Endpoint is one registered receiver. It never holds the signing secret: the
// secret exists in clear only while it is returned to the operator or signs a
// delivery.
type Endpoint struct {
	ID                  ids.ID
	URL                 string
	Description         string
	EventTypes          []string
	Status              EndpointStatus
	DisabledReason      DisabledReason
	ConsecutiveFailures int
	CreatedAt           time.Time
	UpdatedAt           time.Time
}

// NewEndpoint validates and builds an active endpoint. offered is the set of
// event types the server offers to webhooks.
func NewEndpoint(id ids.ID, rawURL, description string, eventTypes, offered []string, now time.Time) (Endpoint, error) {
	const op = "webhooks.NewEndpoint"
	rawURL = strings.TrimSpace(rawURL)
	description = strings.TrimSpace(description)
	if err := ValidateURL(rawURL); err != nil {
		return Endpoint{}, err
	}
	if utf8.RuneCountInString(description) > MaxDescriptionLen {
		return Endpoint{}, sharederrors.Validation(op, "description is too long")
	}
	if len(eventTypes) == 0 || len(eventTypes) > MaxEventTypes {
		return Endpoint{}, sharederrors.Validation(op, "between 1 and 32 event types are required")
	}
	types := slices.Clone(eventTypes)
	slices.Sort(types)
	if len(slices.Compact(slices.Clone(types))) != len(types) {
		return Endpoint{}, sharederrors.Validation(op, "event types must be distinct")
	}
	for _, t := range types {
		if !slices.Contains(offered, t) {
			return Endpoint{}, sharederrors.Validation(op, "event type is not offered to webhooks: "+t).WithReason("UNKNOWN_EVENT_TYPE")
		}
	}
	return Endpoint{
		ID: id, URL: rawURL, Description: description, EventTypes: types,
		Status: EndpointActive, CreatedAt: now, UpdatedAt: now,
	}, nil
}

// ValidateURL accepts an absolute https URL with a host, without credentials or
// a fragment. The address the host resolves to is checked when a delivery
// connects (platform/webhooks), not here: it can change after registration.
func ValidateURL(raw string) error {
	const op = "webhooks.ValidateURL"
	if raw == "" || len(raw) > MaxURLLen {
		return sharederrors.Validation(op, "url is required and at most 2048 bytes")
	}
	u, err := url.Parse(raw)
	switch {
	case err != nil:
		return sharederrors.Validation(op, "url does not parse")
	case u.Scheme != "https":
		return sharederrors.Validation(op, "url must use https")
	case u.Hostname() == "":
		return sharederrors.Validation(op, "url has no host")
	case u.User != nil:
		return sharederrors.Validation(op, "url must not carry credentials")
	case u.Fragment != "":
		return sharederrors.Validation(op, "url must not have a fragment")
	}
	return nil
}

// NewSecret returns a fresh signing secret in the Standard Webhooks form
// "whsec_<base64 of 32 random bytes>". crypto/rand never fails on supported
// platforms (it aborts the process instead of returning weak output).
func NewSecret() string {
	raw := make([]byte, secretBytes)
	_, _ = rand.Read(raw)
	return secretPrefix + base64.StdEncoding.EncodeToString(raw)
}

// Delivery is one event sent, or to be sent, to one endpoint. The payload is
// not part of it: the log shows what happened, not the event body.
type Delivery struct {
	ID             ids.ID
	EndpointID     ids.ID
	EventID        ids.ID
	EventType      string
	Status         DeliveryStatus
	Attempts       int
	LastStatusCode int
	LastError      string
	CreatedAt      time.Time
	UpdatedAt      time.Time
	DeliveredAt    *time.Time
}

// CheckRedeliverable says why a delivery that the guarded requeue did not move
// cannot be redelivered. nil means it is already pending: the call is a retry
// of an earlier redelivery and there is nothing to do.
func (d Delivery) CheckRedeliverable() error {
	const op = "webhooks.RedeliverDelivery"
	switch d.Status {
	case DeliveryPending:
		return nil
	case DeliveryDelivered:
		return sharederrors.FailedPrecondition(op, "the delivery was already delivered").WithReason("DELIVERY_ALREADY_DELIVERED")
	default:
		// Failed or cancelled, and the requeue was refused: the endpoint is not active.
		return sharederrors.FailedPrecondition(op, "the endpoint is disabled; enable it first").WithReason("ENDPOINT_DISABLED")
	}
}

// Outcome is what one delivery attempt changes in the log and on the endpoint.
type Outcome struct {
	EndpointID ids.ID
	EventID    ids.ID
	Status     DeliveryStatus
	// Sent is false when no request left for the receiver (not counted as an attempt).
	Sent       bool
	StatusCode int
	Error      string
	// EndpointFailed counts towards the endpoint's consecutive failures;
	// EndpointSucceeded resets them.
	EndpointFailed    bool
	EndpointSucceeded bool
}

// List orders bind a page cursor to the list it was issued for
// (internal/shared/pagination).
const (
	EndpointListOrder = "webhooks.endpoints:created_at:desc"
	DeliveryListOrder = "webhooks.deliveries:created_at:desc"
)

// EndpointPage is one keyset page of endpoints; Next is nil on the last page.
type EndpointPage struct {
	Endpoints []Endpoint
	Next      *pagination.Cursor
}

// DeliveryPage is one keyset page of deliveries; Next is nil on the last page.
type DeliveryPage struct {
	Deliveries []Delivery
	Next       *pagination.Cursor
}

// SealedEndpoint is what a delivery needs to be sent: the URL, whether the
// endpoint is active, and the signing secret as it is stored (sealed).
type SealedEndpoint struct {
	URL    string
	Active bool
	Sealed []byte
}
