// Package secretbox seals endpoint signing secrets at rest with AES-256-GCM
// (crypto/aes, crypto/cipher). A signing secret must be available in clear to
// compute an HMAC, so it cannot be hashed; it is encrypted instead, with a key
// that lives only in the process environment (AEDST_WEBHOOKS_SECRET_KEY).
//
// Sealed form: one key-version byte, the 12-byte random nonce, then the
// ciphertext with its tag. The key version and the endpoint id are the
// additional authenticated data, so a ciphertext copied to another endpoint's
// row, or relabelled with another key version, does not open. The version byte
// is what makes key rotation possible: new secrets are sealed with the current
// key while older rows still open with the key they name.
//
// Custom code is justified: internal/platform has no encryption facility and the
// standard library provides the whole construction; nothing here implements a
// primitive.
package secretbox

import (
	"crypto/aes"
	"crypto/cipher"
	"crypto/rand"
	"errors"
	"fmt"

	"github.com/aedst/server/internal/shared/ids"
)

// KeySize is the AES-256 key length.
const KeySize = 32

// ErrOpen is returned for a sealed secret that does not open: tampered, bound
// to another endpoint, or sealed with a key this process does not have. It says
// nothing about the content.
var ErrOpen = errors.New("secretbox: sealed secret does not open")

// aadLabel separates this use of the key from any other.
const aadLabel = "aedst.webhooks.endpoint-secret"

// Box seals with the current key and opens with any key it holds.
type Box struct {
	current byte
	aeads   map[byte]cipher.AEAD
}

// New builds a Box. keys maps a key version (1..255) to a 32-byte key; current
// names the key new secrets are sealed with.
func New(current byte, keys map[byte][]byte) (*Box, error) {
	aeads := make(map[byte]cipher.AEAD, len(keys))
	for version, key := range keys {
		if version == 0 || len(key) != KeySize {
			return nil, fmt.Errorf("secretbox: key version %d must be 1..255 with a %d-byte key", version, KeySize)
		}
		block, err := aes.NewCipher(key)
		if err != nil {
			return nil, fmt.Errorf("secretbox: key version %d: %w", version, err)
		}
		aead, err := cipher.NewGCM(block)
		if err != nil {
			return nil, fmt.Errorf("secretbox: key version %d: %w", version, err)
		}
		aeads[version] = aead
	}
	if _, ok := aeads[current]; !ok {
		return nil, fmt.Errorf("secretbox: no key for the current version %d", current)
	}
	return &Box{current: current, aeads: aeads}, nil
}

// Seal encrypts secret for the endpoint with the current key and a fresh nonce.
func (b *Box) Seal(endpointID ids.ID, secret string) ([]byte, error) {
	aead := b.aeads[b.current]
	nonce := make([]byte, aead.NonceSize())
	if _, err := rand.Read(nonce); err != nil {
		return nil, fmt.Errorf("secretbox: nonce: %w", err)
	}
	out := make([]byte, 0, 1+len(nonce)+len(secret)+aead.Overhead())
	out = append(out, b.current)
	out = append(out, nonce...)
	return aead.Seal(out, nonce, []byte(secret), aad(b.current, endpointID)), nil
}

// Open decrypts a sealed secret of the endpoint.
func (b *Box) Open(endpointID ids.ID, sealed []byte) (string, error) {
	if len(sealed) < 1 {
		return "", ErrOpen
	}
	version := sealed[0]
	aead, ok := b.aeads[version]
	if !ok || len(sealed) < 1+aead.NonceSize()+aead.Overhead() {
		return "", ErrOpen
	}
	nonce, ciphertext := sealed[1:1+aead.NonceSize()], sealed[1+aead.NonceSize():]
	plain, err := aead.Open(nil, nonce, ciphertext, aad(version, endpointID))
	if err != nil {
		return "", ErrOpen
	}
	return string(plain), nil
}

func aad(version byte, endpointID ids.ID) []byte {
	out := make([]byte, 0, len(aadLabel)+1+len(endpointID))
	out = append(out, aadLabel...)
	out = append(out, version)
	return append(out, endpointID[:]...)
}
