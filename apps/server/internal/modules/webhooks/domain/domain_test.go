package domain_test

import (
	"encoding/base64"
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/webhooks/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

var offered = []string{"tasks.v1.TaskCompleted", "tasks.v1.TaskCreated", "media.v1.MediaReady"}

func TestNewEndpoint(t *testing.T) {
	now := time.Date(2026, 11, 21, 10, 0, 0, 0, time.UTC)
	id := ids.New()
	e, err := domain.NewEndpoint(id, "  https://hooks.example.com/in?x=1 ", " billing ", []string{"tasks.v1.TaskCreated", "tasks.v1.TaskCompleted"}, offered, now)
	if err != nil {
		t.Fatalf("NewEndpoint() = %v", err)
	}
	if e.ID != id || e.URL != "https://hooks.example.com/in?x=1" || e.Description != "billing" {
		t.Errorf("endpoint = %+v, want trimmed url and description", e)
	}
	if e.Status != domain.EndpointActive || e.DisabledReason != domain.DisabledNone || e.ConsecutiveFailures != 0 {
		t.Errorf("a new endpoint must be active with no failures: %+v", e)
	}
	if got := strings.Join(e.EventTypes, ","); got != "tasks.v1.TaskCompleted,tasks.v1.TaskCreated" {
		t.Errorf("event types = %s, want them sorted", got)
	}
	if !e.CreatedAt.Equal(now) || !e.UpdatedAt.Equal(now) {
		t.Errorf("timestamps = %v / %v, want %v", e.CreatedAt, e.UpdatedAt, now)
	}
}

func TestNewEndpoint_Rejects(t *testing.T) {
	one := []string{"tasks.v1.TaskCreated"}
	tooMany := make([]string, domain.MaxEventTypes+1)
	for i := range tooMany {
		tooMany[i] = "tasks.v1.TaskCreated"
	}
	tests := []struct {
		name        string
		url         string
		description string
		types       []string
		wantReason  string
	}{
		{"empty url", "", "", one, ""},
		{"http", "http://hooks.example.com/in", "", one, ""},
		{"no host", "https:///in", "", one, ""},
		{"credentials", "https://user:pw@hooks.example.com/in", "", one, ""},
		{"fragment", "https://hooks.example.com/in#frag", "", one, ""},
		{"relative", "/in", "", one, ""},
		{"url too long", "https://hooks.example.com/" + strings.Repeat("a", domain.MaxURLLen), "", one, ""},
		{"description too long", "https://hooks.example.com/in", strings.Repeat("é", domain.MaxDescriptionLen+1), one, ""},
		{"no event types", "https://hooks.example.com/in", "", nil, ""},
		{"too many event types", "https://hooks.example.com/in", "", tooMany, ""},
		{"duplicate event types", "https://hooks.example.com/in", "", []string{"tasks.v1.TaskCreated", "tasks.v1.TaskCreated"}, ""},
		{"unknown event type", "https://hooks.example.com/in", "", []string{"billing.v1.Paid"}, "UNKNOWN_EVENT_TYPE"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			_, err := domain.NewEndpoint(ids.New(), tt.url, tt.description, tt.types, offered, time.Now())
			if sharederrors.KindOf(err) != sharederrors.KindValidation {
				t.Fatalf("NewEndpoint() = %v, want a validation error", err)
			}
			if tt.wantReason != "" && sharederrors.ReasonOf(err) != tt.wantReason {
				t.Errorf("reason = %q, want %q", sharederrors.ReasonOf(err), tt.wantReason)
			}
		})
	}
}

func TestNewEndpoint_DescriptionLimitCountsCharacters(t *testing.T) {
	// 500 two-byte characters are 1000 bytes and still allowed.
	_, err := domain.NewEndpoint(ids.New(), "https://hooks.example.com/in", strings.Repeat("é", domain.MaxDescriptionLen), offered[:1], offered, time.Now())
	if err != nil {
		t.Fatalf("NewEndpoint() = %v, want nil", err)
	}
}

func TestNewSecret_StandardWebhooksForm(t *testing.T) {
	a, b := domain.NewSecret(), domain.NewSecret()
	if a == b {
		t.Fatal("two secrets are equal")
	}
	raw, ok := strings.CutPrefix(a, "whsec_")
	if !ok {
		t.Fatalf("secret %q has no whsec_ prefix", a[:6])
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != 32 {
		t.Fatalf("secret body decodes to %d bytes (%v), want 32", len(key), err)
	}
}

func TestDelivery_CheckRedeliverable(t *testing.T) {
	tests := []struct {
		status     domain.DeliveryStatus
		wantReason string
	}{
		{domain.DeliveryPending, ""},
		{domain.DeliveryDelivered, "DELIVERY_ALREADY_DELIVERED"},
		{domain.DeliveryFailed, "ENDPOINT_DISABLED"},
		{domain.DeliveryCancelled, "ENDPOINT_DISABLED"},
	}
	for _, tt := range tests {
		err := domain.Delivery{Status: tt.status}.CheckRedeliverable()
		if tt.wantReason == "" {
			if err != nil {
				t.Errorf("%s: CheckRedeliverable() = %v, want nil", tt.status, err)
			}
			continue
		}
		if sharederrors.KindOf(err) != sharederrors.KindFailedPrecondition || sharederrors.ReasonOf(err) != tt.wantReason {
			t.Errorf("%s: CheckRedeliverable() = %v, want FailedPrecondition %s", tt.status, err, tt.wantReason)
		}
	}
}
