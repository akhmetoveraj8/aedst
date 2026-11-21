package config_test

import (
	"bytes"
	"encoding/base64"
	"strings"
	"testing"

	"github.com/aedst/server/internal/platform/config"
)

func webhookKey(fill byte) string {
	return base64.StdEncoding.EncodeToString(bytes.Repeat([]byte{fill}, config.WebhookKeySize))
}

func TestConfig_ValidateWebhooks(t *testing.T) {
	enabled := func(mutate func(*config.WebhooksConfig)) func(*config.Config) {
		return func(c *config.Config) {
			c.Webhooks = config.WebhooksConfig{Enabled: true, SecretKey: webhookKey(1), DisableAfterFailures: 5, DeliveryRetentionDays: 30}
			if mutate != nil {
				mutate(&c.Webhooks)
			}
		}
	}
	tests := []struct {
		name    string
		mutate  func(*config.Config)
		wantErr string
	}{
		{"disabled needs nothing", func(c *config.Config) { c.Webhooks = config.WebhooksConfig{SecretKey: "bogus"} }, ""},
		{"valid", enabled(nil), ""},
		{"versioned key with a previous one", enabled(func(w *config.WebhooksConfig) {
			w.SecretKey, w.PreviousSecretKeys = "2:"+webhookKey(2), []string{"1:" + webhookKey(1)}
		}), ""},
		{"missing key", enabled(func(w *config.WebhooksConfig) { w.SecretKey = "" }), "AEDST_WEBHOOKS_SECRET_KEY"},
		{"short key", enabled(func(w *config.WebhooksConfig) { w.SecretKey = base64.StdEncoding.EncodeToString([]byte("short")) }), "32 bytes"},
		{"version out of range", enabled(func(w *config.WebhooksConfig) { w.SecretKey = "256:" + webhookKey(1) }), "1..255"},
		{"previous key without a version", enabled(func(w *config.WebhooksConfig) { w.PreviousSecretKeys = []string{webhookKey(2)} }), "<version>:<base64>"},
		{"previous key repeats the current version", enabled(func(w *config.WebhooksConfig) { w.PreviousSecretKeys = []string{"1:" + webhookKey(2)} }), "repeats key version 1"},
		{"zero failure threshold", enabled(func(w *config.WebhooksConfig) { w.DisableAfterFailures = 0 }), "AEDST_WEBHOOKS_DISABLE_AFTER_FAILURES"},
		{"zero retention", enabled(func(w *config.WebhooksConfig) { w.DeliveryRetentionDays = 0 }), "AEDST_WEBHOOKS_DELIVERY_RETENTION_DAYS"},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			cfg := validConfig()
			tt.mutate(&cfg)
			err := cfg.Validate()
			switch {
			case tt.wantErr == "" && err != nil:
				t.Fatalf("Validate() = %v, want nil", err)
			case tt.wantErr != "" && (err == nil || !strings.Contains(err.Error(), tt.wantErr)):
				t.Fatalf("Validate() = %v, want error containing %q", err, tt.wantErr)
			}
		})
	}
}

func TestWebhooksConfig_SecretKeysNeverEchoKeyMaterial(t *testing.T) {
	bad := "1:" + strings.Repeat("A", 20)
	_, err := config.WebhooksConfig{SecretKey: bad}.SecretKeys()
	if err == nil || strings.Contains(err.Error(), "AAAA") {
		t.Fatalf("SecretKeys() error = %v, want an error without key material", err)
	}
	keys, err := config.WebhooksConfig{SecretKey: "3:" + webhookKey(3), PreviousSecretKeys: []string{"2:" + webhookKey(2), " "}}.SecretKeys()
	if err != nil || keys.Current != 3 || len(keys.Keys) != 2 {
		t.Fatalf("SecretKeys() = %+v, %v; want current 3 and two keys", keys.Current, err)
	}
}
