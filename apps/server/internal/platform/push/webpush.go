package push

import (
	"context"
	"crypto/ecdh"
	"crypto/sha256"
	"encoding/base64"
	"encoding/json"
	"errors"
	"fmt"
	"io"
	"net/http"
	"net/url"
	"strings"
	"time"

	webpush "github.com/SherClockHolmes/webpush-go"
)

// WebPushConfig holds the VAPID application server keys (AEDST_PUSH_VAPID_*).
// Generate a pair once per deployment, e.g. `npx web-push generate-vapid-keys`.
type WebPushConfig struct {
	// PublicKey is the base64url uncompressed P-256 point (65 bytes); clients
	// pass it to PushManager.subscribe as applicationServerKey. Optional: it
	// is derived from PrivateKey, and must match it when set.
	PublicKey string
	// PrivateKey is the base64url raw P-256 scalar (32 bytes).
	PrivateKey string
	// Subject is a mailto: or https: contact for the push service operator.
	Subject string
}

// WebPush sends RFC 8291 (aes128gcm) encrypted messages with VAPID auth
// through webpush-go.
type WebPush struct {
	privateKey string
	publicKey  string
	subject    string
	client     webpush.HTTPClient
}

// maxWebPushPayload is the plaintext budget: push services must accept 4096
// bytes of ciphertext; webpush-go's header (86), tag (16) and padding
// delimiter (1) leave this.
const maxWebPushPayload = 3993

// NewWebPush validates the VAPID keys and returns the sender. client carries
// the HTTP calls to the browsers' push services (tests point it at a fake).
func NewWebPush(cfg WebPushConfig, client *http.Client) (*WebPush, error) {
	private := strings.TrimRight(strings.TrimSpace(cfg.PrivateKey), "=")
	d, err := base64.RawURLEncoding.DecodeString(private)
	if err != nil {
		return nil, fmt.Errorf("push: vapid private key: %w", err)
	}
	key, err := ecdh.P256().NewPrivateKey(d)
	if err != nil {
		return nil, fmt.Errorf("push: vapid private key: %w", err)
	}
	derived := base64.RawURLEncoding.EncodeToString(key.PublicKey().Bytes())
	if cfg.PublicKey != "" && strings.TrimRight(cfg.PublicKey, "=") != derived {
		return nil, errors.New("push: AEDST_PUSH_VAPID_PUBLIC_KEY does not match the private key")
	}
	if !strings.HasPrefix(cfg.Subject, "mailto:") && !strings.HasPrefix(cfg.Subject, "https://") {
		return nil, errors.New("push: AEDST_PUSH_VAPID_SUBJECT must be a mailto: or https: URL")
	}
	if client == nil {
		return nil, errors.New("push: web push needs an HTTP client (use NewHTTPClient: the default client has no timeout or breaker)")
	}
	return &WebPush{privateKey: private, publicKey: derived, subject: cfg.Subject, client: client}, nil
}

// PublicKey is the applicationServerKey clients subscribe with.
func (w *WebPush) PublicKey() string { return w.publicKey }

// webPushPayload is the JSON the service worker receives (event.data.json()).
type webPushPayload struct {
	Title          string            `json:"title"`
	Body           string            `json:"body"`
	Link           string            `json:"link"`
	Kind           string            `json:"kind"`
	NotificationID string            `json:"notification_id"`
	Tag            string            `json:"tag,omitempty"`
	Data           map[string]string `json:"data,omitempty"`
}

// attemptClient records whether the request reached the HTTP client, which
// is how Send tells a malformed subscription (webpush-go fails while building
// the request) from a transport failure.
type attemptClient struct {
	inner     webpush.HTTPClient
	attempted bool
}

func (c *attemptClient) Do(req *http.Request) (*http.Response, error) {
	c.attempted = true
	return c.inner.Do(req)
}

func (w *WebPush) Send(ctx context.Context, target Target, msg Message) error {
	endpoint, err := url.Parse(target.Endpoint)
	if err != nil || endpoint.Scheme != "https" || endpoint.Host == "" {
		return fmt.Errorf("%w: web push endpoint must be an https URL", ErrInvalidToken)
	}
	plaintext, err := json.Marshal(webPushPayload{Title: msg.Title, Body: msg.Body, Link: msg.Link, Kind: msg.Kind, NotificationID: msg.NotificationID, Tag: msg.CollapseID, Data: msg.Data})
	if err != nil {
		return fmt.Errorf("%w: encode payload: %w", ErrPermanent, err)
	}
	if len(plaintext) > maxWebPushPayload {
		return fmt.Errorf("%w: web push payload is %d bytes (max %d)", ErrPermanent, len(plaintext), maxWebPushPayload)
	}
	ttl := msg.TTL
	if ttl <= 0 {
		ttl = 24 * time.Hour
	}
	opts := &webpush.Options{
		Subscriber:      strings.TrimPrefix(w.subject, "mailto:"), // webpush-go prefixes mailto: itself
		VAPIDPublicKey:  w.publicKey,
		VAPIDPrivateKey: w.privateKey,
		TTL:             int(ttl.Seconds()),
		Urgency:         webpush.UrgencyNormal,
	}
	if msg.CollapseID != "" {
		opts.Topic = topicHeader(msg.CollapseID)
	}
	attempt := &attemptClient{inner: w.client}
	opts.HTTPClient = attempt

	resp, err := webpush.SendNotificationWithContext(ctx, plaintext, &webpush.Subscription{
		Endpoint: target.Endpoint,
		Keys:     webpush.Keys{P256dh: target.P256dh, Auth: target.Auth},
	}, opts)
	if err != nil {
		switch {
		case errors.Is(err, webpush.ErrMaxPadExceeded):
			return fmt.Errorf("%w: %w", ErrPermanent, err)
		case !attempt.attempted:
			return fmt.Errorf("%w: web push subscription keys: %w", ErrInvalidToken, err) // malformed keys never become valid
		default:
			return fmt.Errorf("push: web push: %w", err)
		}
	}
	defer func() { _ = resp.Body.Close() }()
	detail, _ := io.ReadAll(io.LimitReader(resp.Body, 512))
	return classify("web push", resp.StatusCode, string(detail))
}

// topicHeader makes a Topic header value: at most 32 URL-safe base64 chars.
func topicHeader(id string) string {
	sum := sha256.Sum256([]byte(id))
	return base64.RawURLEncoding.EncodeToString(sum[:])[:32]
}
