package push

import (
	"context"
	"encoding/hex"
	"errors"
	"fmt"
	"net/http"
	"os"
	"strings"
	"time"

	"github.com/sideshow/apns2"
	"github.com/sideshow/apns2/payload"
	"github.com/sideshow/apns2/token"
)

// APNsConfig configures token-based APNs auth (AEDST_PUSH_APNS_*), from the
// .p8 key created in the Apple Developer account.
type APNsConfig struct {
	KeyID  string
	TeamID string
	// PrivateKey is the PEM (.p8) content; PrivateKeyFile a path to it.
	PrivateKey     string
	PrivateKeyFile string
	// DefaultTopic is the bundle id used when a device registered none.
	DefaultTopic string
	// ProductionURL / SandboxURL override the APNs hosts (tests).
	ProductionURL string
	SandboxURL    string
}

// APNs sends over HTTP/2 through apns2 with a provider token (ES256, refreshed
// by the library roughly every 50 minutes). Production and sandbox devices
// use two clients that share the token and the HTTP client.
type APNs struct {
	cfg        APNsConfig
	token      *token.Token
	production *apns2.Client
	sandbox    *apns2.Client
	now        func() time.Time
}

// NewAPNs parses the .p8 key and builds the clients. client is the shared
// HTTP/2-capable HTTP client (NewHTTPClient); nil keeps apns2's own transport.
func NewAPNs(cfg APNsConfig, client *http.Client) (*APNs, error) {
	raw := []byte(cfg.PrivateKey)
	if len(raw) == 0 && cfg.PrivateKeyFile != "" {
		var err error
		if raw, err = os.ReadFile(cfg.PrivateKeyFile); err != nil {
			return nil, fmt.Errorf("push: apns key: %w", err)
		}
	}
	key, err := token.AuthKeyFromBytes(raw)
	if err != nil {
		return nil, fmt.Errorf("push: apns key: %w", err)
	}
	if cfg.KeyID == "" || cfg.TeamID == "" {
		return nil, errors.New("push: AEDST_PUSH_APNS_KEY_ID and AEDST_PUSH_APNS_TEAM_ID are required")
	}
	if cfg.ProductionURL == "" {
		cfg.ProductionURL = apns2.HostProduction
	}
	if cfg.SandboxURL == "" {
		cfg.SandboxURL = apns2.HostDevelopment
	}
	tok := &token.Token{AuthKey: key, KeyID: cfg.KeyID, TeamID: cfg.TeamID}
	newClient := func(host string) *apns2.Client {
		c := apns2.NewTokenClient(tok)
		c.Host = host
		if client != nil {
			c.HTTPClient = client
		}
		return c
	}
	return &APNs{
		cfg:        cfg,
		token:      tok,
		production: newClient(cfg.ProductionURL),
		sandbox:    newClient(cfg.SandboxURL),
		now:        time.Now,
	}, nil
}

func (a *APNs) Send(ctx context.Context, target Target, msg Message) error {
	if _, err := hex.DecodeString(target.Token); err != nil || target.Token == "" {
		return fmt.Errorf("%w: apns token must be hex", ErrInvalidToken)
	}
	topic := target.APNsTopic
	if topic == "" {
		topic = a.cfg.DefaultTopic
	}
	if topic == "" {
		return fmt.Errorf("%w: apns topic (bundle id) unknown; set AEDST_PUSH_APNS_TOPIC", ErrPermanent)
	}
	pl := payload.NewPayload().
		AlertTitle(msg.Title).
		AlertBody(msg.Body).
		Sound("default").
		Custom("link", msg.Link).
		Custom("kind", msg.Kind).
		Custom("notification_id", msg.NotificationID)
	if msg.Badge != nil {
		pl.Badge(*msg.Badge)
	}
	if len(msg.Data) > 0 {
		pl.Custom("data", msg.Data)
	}
	n := &apns2.Notification{
		DeviceToken: target.Token,
		Topic:       topic,
		Priority:    apns2.PriorityHigh,
		PushType:    apns2.PushTypeAlert,
		Payload:     pl,
	}
	if msg.TTL > 0 {
		n.Expiration = a.now().Add(msg.TTL)
	}
	if msg.CollapseID != "" && len(msg.CollapseID) <= 64 {
		n.CollapseID = msg.CollapseID
	}
	client := a.production
	if target.APNsSandbox {
		client = a.sandbox
	}

	resp, err := client.PushWithContext(ctx, n)
	if err != nil {
		return fmt.Errorf("push: apns: %w", err)
	}
	if resp.StatusCode == http.StatusForbidden && resp.Reason == apns2.ReasonExpiredProviderToken {
		// The library refreshes on its own clock; force a new token once in
		// case ours and Apple's disagree.
		a.token.Lock()
		a.token.IssuedAt = 0
		a.token.Unlock()
		if resp, err = client.PushWithContext(ctx, n); err != nil {
			return fmt.Errorf("push: apns: %w", err)
		}
	}
	switch resp.Reason {
	case apns2.ReasonBadDeviceToken, apns2.ReasonUnregistered, apns2.ReasonDeviceTokenNotForTopic:
		return fmt.Errorf("%w: apns %s", ErrInvalidToken, resp.Reason)
	}
	return classify("apns", resp.StatusCode, strings.TrimSpace(resp.Reason))
}
