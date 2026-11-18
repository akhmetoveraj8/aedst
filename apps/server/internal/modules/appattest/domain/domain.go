// Package domain holds the Apple App Attest rules that need no I/O and no
// third-party library: the client-data convention, the App ID policy and the
// judgement of the authenticator data. It depends on the standard library and
// internal/shared only. CBOR decoding and the certificate chain live in
// infrastructure/apple.
package domain

import (
	"bytes"
	"crypto/ecdsa"
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"encoding/binary"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"time"

	"github.com/aedst/server/internal/shared/ids"
)

// ClientDataPrefix versions the client-data convention (see ClientData).
const ClientDataPrefix = "aedst.appattest.v1"

const (
	// ChallengeSize is the length of a server challenge in bytes.
	ChallengeSize = 32
	// ChallengeTTL is how long a challenge can be spent after it was issued.
	ChallengeTTL = 5 * time.Minute
	// KeyIDSize is the length of a decoded key id (SHA-256 of the public key).
	KeyIDSize = sha256.Size
)

// Environment is the App Attest environment a key was generated in.
type Environment string

const (
	EnvironmentProduction  Environment = "production"
	EnvironmentDevelopment Environment = "development"
)

// Reason is why evidence was rejected. The empty Reason means accepted.
type Reason string

const (
	ReasonNone                  Reason = ""
	ReasonChallengeInvalid      Reason = "challenge_invalid"
	ReasonBundleNotAllowed      Reason = "bundle_not_allowed"
	ReasonAttestationMalformed  Reason = "attestation_malformed"
	ReasonCertificateChain      Reason = "certificate_chain_invalid"
	ReasonNonceMismatch         Reason = "nonce_mismatch"
	ReasonKeyIDMismatch         Reason = "key_id_mismatch"
	ReasonAppIDMismatch         Reason = "app_id_mismatch"
	ReasonCounterNotZero        Reason = "counter_not_zero"
	ReasonAAGUIDInvalid         Reason = "aaguid_invalid"
	ReasonEnvironmentNotAllowed Reason = "environment_not_allowed"
	ReasonKeyAlreadyEnrolled    Reason = "key_already_enrolled"
	ReasonKeyUnknown            Reason = "key_unknown"
	ReasonAssertionMalformed    Reason = "assertion_malformed"
	ReasonSignatureInvalid      Reason = "signature_invalid"
	ReasonCounterNotIncreasing  Reason = "counter_not_increasing"
)

// AAGUIDs exactly as Apple documents them: the development environment is the
// ASCII string "appattestdevelop"; production is "appattest" followed by seven
// zero bytes.
var (
	aaguidDevelopment = [16]byte{'a', 'p', 'p', 'a', 't', 't', 'e', 's', 't', 'd', 'e', 'v', 'e', 'l', 'o', 'p'}
	aaguidProduction  = [16]byte{'a', 'p', 'p', 'a', 't', 't', 'e', 's', 't'}
)

// Policy is the App ID allow-list: which apps this server accepts evidence from.
type Policy struct {
	// TeamID is the 10-character Apple Developer Team ID (the App ID prefix).
	TeamID string
	// AllowedBundleIDs are the accepted bundle identifiers.
	AllowedBundleIDs []string
	// AllowDevelopment accepts keys generated in the development environment.
	AllowDevelopment bool
}

var (
	teamIDPattern   = regexp.MustCompile(`^[A-Z0-9]{10}$`)
	bundleIDPattern = regexp.MustCompile(`^[A-Za-z0-9-]+(\.[A-Za-z0-9-]+)*$`)
)

// Validate reports a policy that could not verify anything.
func (p Policy) Validate() error {
	if !teamIDPattern.MatchString(p.TeamID) {
		return errors.New("appattest: team id must be 10 upper-case letters or digits")
	}
	if len(p.AllowedBundleIDs) == 0 {
		return errors.New("appattest: at least one bundle id is required")
	}
	for _, b := range p.AllowedBundleIDs {
		if len(b) > 155 || !bundleIDPattern.MatchString(b) {
			return errors.New("appattest: invalid bundle id in the allow-list")
		}
	}
	return nil
}

// BundleAllowed reports whether bundleID is in the allow-list.
func (p Policy) BundleAllowed(bundleID string) bool {
	return bundleID != "" && slices.Contains(p.AllowedBundleIDs, bundleID)
}

// ResolveBundle picks the bundle id to validate for: the requested one, or the
// only allowed one when the request leaves it empty. ok is false when the
// bundle is not allowed or the choice is ambiguous.
func (p Policy) ResolveBundle(requested string) (string, bool) {
	if requested == "" {
		if len(p.AllowedBundleIDs) == 1 {
			return p.AllowedBundleIDs[0], true
		}
		return "", false
	}
	return requested, p.BundleAllowed(requested)
}

// AppID is "<team id>.<bundle id>", the value whose SHA-256 is the RP ID hash.
func (p Policy) AppID(bundleID string) string { return p.TeamID + "." + bundleID }

// EnvironmentAllowed applies the development switch.
func (p Policy) EnvironmentAllowed(e Environment) bool {
	return e == EnvironmentProduction || (e == EnvironmentDevelopment && p.AllowDevelopment)
}

// Attested is what a successfully validated attestation proves.
type Attested struct {
	PublicKey   *ecdsa.PublicKey
	Environment Environment
}

// AttestationInput is one attestation to validate. ClientDataHash is what the
// client passed to attestKey: SHA-256 of the server challenge.
type AttestationInput struct {
	Object         []byte
	ClientDataHash []byte
	KeyID          []byte
	AppID          string
}

// AssertionInput is one assertion to validate against an enrolled key.
type AssertionInput struct {
	Object         []byte
	ClientDataHash [sha256.Size]byte
	PublicKey      *ecdsa.PublicKey
	AppID          string
}

// Key is an enrolled, attested key.
type Key struct {
	ID          []byte
	UserID      ids.ID
	BundleID    string
	PublicKey   *ecdsa.PublicKey
	Counter     uint32
	Environment Environment
	CreatedAt   time.Time
	LastUsedAt  time.Time
}

// ClientData is the byte string an assertion is made over (convention in
// appattest.proto): "aedst.appattest.v1" LF action LF payload.
func ClientData(action string, payload []byte) []byte {
	out := make([]byte, 0, len(ClientDataPrefix)+len(action)+len(payload)+2)
	out = append(out, ClientDataPrefix...)
	out = append(out, '\n')
	out = append(out, action...)
	out = append(out, '\n')
	return append(out, payload...)
}

// ClientDataHash is SHA-256(ClientData(action, payload)), what the client
// passes to generateAssertion.
func ClientDataHash(action string, payload []byte) [sha256.Size]byte {
	return sha256.Sum256(ClientData(action, payload))
}

var actionPattern = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,63}$`)

// ValidAction reports whether action is a legal action name.
func ValidAction(action string) bool { return actionPattern.MatchString(action) }

// DecodeKeyID decodes the client's key id (canonical standard base64 of 32 bytes).
func DecodeKeyID(s string) ([]byte, error) {
	// Strict: non-zero trailing bits would give several spellings of one key id.
	b, err := base64.StdEncoding.Strict().DecodeString(s)
	// DecodeString silently skips CR and LF, so compare the canonical spelling.
	if err != nil || len(b) != KeyIDSize || base64.StdEncoding.EncodeToString(b) != s {
		return nil, errors.New("appattest: key id must be the base64 of 32 bytes")
	}
	return b, nil
}

// KeyIDOf is SHA-256 over the public key as an uncompressed X9.62 point
// (0x04 || X || Y), the key identifier Apple documents.
func KeyIDOf(pub *ecdsa.PublicKey) ([]byte, error) {
	point, err := pub.Bytes()
	if err != nil {
		return nil, fmt.Errorf("appattest: public key: %w", err)
	}
	sum := sha256.Sum256(point)
	return sum[:], nil
}

// RPIDHash is SHA-256 of the App ID.
func RPIDHash(appID string) [sha256.Size]byte { return sha256.Sum256([]byte(appID)) }

// Authenticator data layout (WebAuthn, as used by App Attest):
//
//	rpIdHash (32) | flags (1) | counter (4, big endian) |
//	[attested credential data: aaguid (16) | credentialId length (2) | credentialId | COSE key | extensions]
const (
	authDataMinLen = 32 + 1 + 4
	flagAttested   = 0x40 // AT: attested credential data present
)

// AuthData is the parsed fixed part of authenticator data.
type AuthData struct {
	RPIDHash     [sha256.Size]byte
	Flags        byte
	Counter      uint32
	AAGUID       [16]byte
	CredentialID []byte
	// HasCredential reports whether attested credential data was parsed.
	HasCredential bool
}

// ErrAuthData is returned for authenticator data that is too short or inconsistent.
var ErrAuthData = errors.New("appattest: malformed authenticator data")

// ParseAssertionAuthData parses the short form carried by an assertion
// (rpIdHash, flags, counter). Trailing extension bytes are tolerated.
func ParseAssertionAuthData(b []byte) (AuthData, error) {
	if len(b) < authDataMinLen {
		return AuthData{}, ErrAuthData
	}
	var ad AuthData
	copy(ad.RPIDHash[:], b[:32])
	ad.Flags = b[32]
	ad.Counter = binary.BigEndian.Uint32(b[33:37])
	return ad, nil
}

// ParseAttestationAuthData parses the authenticator data of an attestation,
// which must carry attested credential data. The COSE key and extensions after
// the credential id are ignored: the public key is taken from the certificate.
func ParseAttestationAuthData(b []byte) (AuthData, error) {
	ad, err := ParseAssertionAuthData(b)
	if err != nil {
		return AuthData{}, err
	}
	if ad.Flags&flagAttested == 0 {
		return AuthData{}, ErrAuthData
	}
	rest := b[authDataMinLen:]
	if len(rest) < 16+2 {
		return AuthData{}, ErrAuthData
	}
	copy(ad.AAGUID[:], rest[:16])
	idLen := int(binary.BigEndian.Uint16(rest[16:18]))
	rest = rest[18:]
	if idLen == 0 || len(rest) < idLen {
		return AuthData{}, ErrAuthData
	}
	ad.CredentialID = bytes.Clone(rest[:idLen])
	ad.HasCredential = true
	return ad, nil
}

// EnvironmentOf maps an aaguid to its environment.
func EnvironmentOf(aaguid [16]byte) (Environment, bool) {
	switch aaguid {
	case aaguidProduction:
		return EnvironmentProduction, true
	case aaguidDevelopment:
		return EnvironmentDevelopment, true
	default:
		return "", false
	}
}

// JudgeAttestation applies steps 6-9 of Apple's attestation checklist to the
// authenticator data: RP ID hash, counter 0, aaguid, credentialId == key id.
// It returns the key's environment, and a Reason when a check fails.
func JudgeAttestation(ad AuthData, appID string, keyID []byte) (Environment, Reason) {
	if want := RPIDHash(appID); subtle.ConstantTimeCompare(ad.RPIDHash[:], want[:]) != 1 {
		return "", ReasonAppIDMismatch
	}
	if ad.Counter != 0 {
		return "", ReasonCounterNotZero
	}
	env, ok := EnvironmentOf(ad.AAGUID)
	if !ok {
		return "", ReasonAAGUIDInvalid
	}
	if !ad.HasCredential || subtle.ConstantTimeCompare(ad.CredentialID, keyID) != 1 {
		return "", ReasonKeyIDMismatch
	}
	return env, ReasonNone
}
