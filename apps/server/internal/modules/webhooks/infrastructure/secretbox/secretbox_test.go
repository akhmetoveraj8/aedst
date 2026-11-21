package secretbox_test

import (
	"bytes"
	"errors"
	"testing"

	"github.com/aedst/server/internal/modules/webhooks/infrastructure/secretbox"
	"github.com/aedst/server/internal/shared/ids"
)

const secret = "whsec_MfKQ9r8GKYqrTwjUPD8ILPZIo2LaLaSw"

func key(fill byte) []byte { return bytes.Repeat([]byte{fill}, secretbox.KeySize) }

func mustBox(t *testing.T, current byte, keys map[byte][]byte) *secretbox.Box {
	t.Helper()
	box, err := secretbox.New(current, keys)
	if err != nil {
		t.Fatalf("New() = %v", err)
	}
	return box
}

func TestBox_RoundTrip(t *testing.T) {
	box := mustBox(t, 1, map[byte][]byte{1: key(7)})
	endpoint := ids.New()
	sealed, err := box.Seal(endpoint, secret)
	if err != nil {
		t.Fatalf("Seal() = %v", err)
	}
	if bytes.Contains(sealed, []byte(secret)) || bytes.Contains(sealed, []byte("whsec_")) {
		t.Fatal("the sealed form contains the secret in clear")
	}
	if sealed[0] != 1 {
		t.Fatalf("key version byte = %d, want 1", sealed[0])
	}
	got, err := box.Open(endpoint, sealed)
	if err != nil || got != secret {
		t.Fatalf("Open() = %q, %v; want the secret back", got, err)
	}
	again, err := box.Seal(endpoint, secret)
	if err != nil || bytes.Equal(sealed, again) {
		t.Fatalf("sealing twice gave the same bytes (%v): the nonce is not fresh", err)
	}
}

func TestBox_DetectsTampering(t *testing.T) {
	box := mustBox(t, 1, map[byte][]byte{1: key(7)})
	endpoint := ids.New()
	sealed, err := box.Seal(endpoint, secret)
	if err != nil {
		t.Fatal(err)
	}
	flip := func(i int) []byte {
		out := bytes.Clone(sealed)
		out[i] ^= 0x01
		return out
	}
	tests := []struct {
		name     string
		endpoint ids.ID
		sealed   []byte
		box      *secretbox.Box
	}{
		{"flipped ciphertext bit", endpoint, flip(len(sealed) - 20), box},
		{"flipped tag bit", endpoint, flip(len(sealed) - 1), box},
		{"flipped nonce bit", endpoint, flip(3), box},
		{"relabelled key version", endpoint, append([]byte{3}, sealed[1:]...), mustBox(t, 1, map[byte][]byte{1: key(7), 3: key(7)})},
		{"moved to another endpoint", ids.New(), sealed, box},
		{"another key", endpoint, sealed, mustBox(t, 1, map[byte][]byte{1: key(8)})},
		{"unknown key version", endpoint, sealed, mustBox(t, 2, map[byte][]byte{2: key(7)})},
		{"truncated", endpoint, sealed[:10], box},
		{"empty", endpoint, nil, box},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			got, err := tt.box.Open(tt.endpoint, tt.sealed)
			if !errors.Is(err, secretbox.ErrOpen) || got != "" {
				t.Fatalf("Open() = %q, %v; want ErrOpen and no plaintext", got, err)
			}
		})
	}
}

func TestBox_KeyRotation(t *testing.T) {
	endpoint := ids.New()
	old := mustBox(t, 1, map[byte][]byte{1: key(7)})
	sealedOld, err := old.Seal(endpoint, secret)
	if err != nil {
		t.Fatal(err)
	}
	// After the rotation: version 2 seals, version 1 is kept to open old rows.
	rotated := mustBox(t, 2, map[byte][]byte{1: key(7), 2: key(9)})
	if got, err := rotated.Open(endpoint, sealedOld); err != nil || got != secret {
		t.Fatalf("Open(old row) = %q, %v; want the secret", got, err)
	}
	sealedNew, err := rotated.Seal(endpoint, secret)
	if err != nil || sealedNew[0] != 2 {
		t.Fatalf("Seal() after rotation used key version %d (%v), want 2", sealedNew[0], err)
	}
	if _, err := old.Open(endpoint, sealedNew); !errors.Is(err, secretbox.ErrOpen) {
		t.Fatalf("a process without key 2 opened a version 2 secret: %v", err)
	}
}

func TestNew_RejectsBadKeys(t *testing.T) {
	tests := []struct {
		name    string
		current byte
		keys    map[byte][]byte
	}{
		{"short key", 1, map[byte][]byte{1: []byte("short")}},
		{"version zero", 0, map[byte][]byte{0: key(1)}},
		{"no key for the current version", 2, map[byte][]byte{1: key(1)}},
		{"no keys", 1, nil},
	}
	for _, tt := range tests {
		if _, err := secretbox.New(tt.current, tt.keys); err == nil {
			t.Errorf("%s: New() = nil, want an error", tt.name)
		}
	}
}
