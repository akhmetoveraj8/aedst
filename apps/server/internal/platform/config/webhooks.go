package config

import (
	"encoding/base64"
	"errors"
	"fmt"
	"strconv"
	"strings"
)

// WebhooksConfig configures outbound webhooks (modules/webhooks). Disabled by
// default: WebhooksService answers FAILED_PRECONDITION, no event is fanned out
// and nothing is sent.
type WebhooksConfig struct {
	Enabled bool `env:"AEDST_WEBHOOKS_ENABLED" envDefault:"false"`
	// SecretKey is the AES-256 key that seals endpoint signing secrets at rest:
	// 32 random bytes in base64, optionally prefixed with its version
	// ("2:<base64>", 1 to 255; no prefix means version 1). New secrets are
	// sealed with this key. Required when enabled.
	SecretKey string `env:"AEDST_WEBHOOKS_SECRET_KEY" envDefault:""`
	// PreviousSecretKeys are older keys ("<version>:<base64>"), kept only to open
	// secrets sealed before a key rotation. Rotating the key: give the new key
	// the next version in SecretKey and move the old one here.
	PreviousSecretKeys []string `env:"AEDST_WEBHOOKS_PREVIOUS_SECRET_KEYS" envSeparator:"," envDefault:""`
	// AllowedHosts restricts deliveries to these hosts (exact, or a
	// ".example.com" suffix). Empty allows any host with a public address.
	AllowedHosts []string `env:"AEDST_WEBHOOKS_ALLOWED_HOSTS" envSeparator:"," envDefault:""`
	// DisableAfterFailures disables an endpoint after this many failed
	// deliveries in a row (rejected by the receiver, or every retry used up).
	DisableAfterFailures int `env:"AEDST_WEBHOOKS_DISABLE_AFTER_FAILURES" envDefault:"5"`
	// DeliveryRetentionDays is how long the delivery log is kept. A delivery is
	// retried for about three weeks, so less than that drops rows still in flight.
	DeliveryRetentionDays int `env:"AEDST_WEBHOOKS_DELIVERY_RETENTION_DAYS" envDefault:"30"`
}

// WebhookKeySize is the AES-256 key length.
const WebhookKeySize = 32

// WebhookKeys is the sealing key set: Current seals, every key in Keys opens.
type WebhookKeys struct {
	Current byte
	Keys    map[byte][]byte
}

// SecretKeys parses SecretKey and PreviousSecretKeys. Errors never contain key
// material.
func (w WebhooksConfig) SecretKeys() (WebhookKeys, error) {
	if w.SecretKey == "" {
		return WebhookKeys{}, errors.New("AEDST_WEBHOOKS_SECRET_KEY is empty")
	}
	version, key, err := parseWebhookKey(w.SecretKey, true)
	if err != nil {
		return WebhookKeys{}, fmt.Errorf("AEDST_WEBHOOKS_SECRET_KEY %w", err)
	}
	out := WebhookKeys{Current: version, Keys: map[byte][]byte{version: key}}
	for _, raw := range w.PreviousSecretKeys {
		if strings.TrimSpace(raw) == "" {
			continue
		}
		v, k, err := parseWebhookKey(raw, false)
		if err != nil {
			return WebhookKeys{}, fmt.Errorf("AEDST_WEBHOOKS_PREVIOUS_SECRET_KEYS %w", err)
		}
		if _, dup := out.Keys[v]; dup {
			return WebhookKeys{}, fmt.Errorf("AEDST_WEBHOOKS_PREVIOUS_SECRET_KEYS repeats key version %d", v)
		}
		out.Keys[v] = k
	}
	return out, nil
}

// parseWebhookKey reads "[<version>:]<base64>"; the version may be omitted
// (meaning 1) only where versionOptional is set.
func parseWebhookKey(raw string, versionOptional bool) (byte, []byte, error) {
	raw = strings.TrimSpace(raw)
	version := 1
	if prefix, rest, ok := strings.Cut(raw, ":"); ok {
		v, err := strconv.Atoi(prefix)
		if err != nil || v < 1 || v > 255 {
			return 0, nil, errors.New("has a key version outside 1..255")
		}
		version, raw = v, rest
	} else if !versionOptional {
		return 0, nil, errors.New("entries need the form <version>:<base64>")
	}
	key, err := base64.StdEncoding.DecodeString(raw)
	if err != nil || len(key) != WebhookKeySize {
		return 0, nil, errors.New("must be 32 bytes in standard base64")
	}
	return byte(version), key, nil
}

func (c Config) validateWebhooks(bad func(string, ...any)) {
	w := c.Webhooks
	if !w.Enabled {
		return
	}
	if _, err := w.SecretKeys(); err != nil {
		bad("AEDST_WEBHOOKS_ENABLED requires a valid sealing key: %v", err)
	}
	if w.DisableAfterFailures <= 0 || w.DeliveryRetentionDays <= 0 {
		bad("AEDST_WEBHOOKS_DISABLE_AFTER_FAILURES and AEDST_WEBHOOKS_DELIVERY_RETENTION_DAYS must be positive")
	}
}
