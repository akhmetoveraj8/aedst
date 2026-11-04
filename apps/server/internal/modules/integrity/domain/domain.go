// Package domain holds the Play Integrity verdict policy: pure rules over the
// evidence Google returns, with no I/O. It depends on the standard library only.
package domain

import (
	"crypto/sha256"
	"crypto/subtle"
	"encoding/base64"
	"errors"
	"fmt"
	"regexp"
	"slices"
	"strings"
	"time"
)

// Verdict strings exactly as Google returns them (playintegrity v1,
// tokenPayloadExternal).
const (
	DeviceBasic   = "MEETS_BASIC_INTEGRITY"
	DeviceDevice  = "MEETS_DEVICE_INTEGRITY"
	DeviceStrong  = "MEETS_STRONG_INTEGRITY"
	DeviceVirtual = "MEETS_VIRTUAL_INTEGRITY"

	AppPlayRecognized      = "PLAY_RECOGNIZED"
	AppUnrecognizedVersion = "UNRECOGNIZED_VERSION"
	AppUnevaluated         = "UNEVALUATED"

	AccountLicensed    = "LICENSED"
	AccountUnlicensed  = "UNLICENSED"
	AccountUnevaluated = "UNEVALUATED"
)

// HashPrefix versions the request-binding convention (see RequestHash).
const HashPrefix = "aedst.integrity.v1"

// Reason is why a token was rejected. The empty Reason means accepted.
type Reason string

const (
	ReasonNone                Reason = ""
	ReasonTokenUndecodable    Reason = "token_undecodable" //nolint:gosec // G101 false positive: a failure-reason code, not a credential
	ReasonRequestHashMismatch Reason = "request_hash_mismatch"
	ReasonTokenNotBound       Reason = "token_not_bound"
	ReasonPackageMismatch     Reason = "package_mismatch"
	ReasonTokenExpired        Reason = "token_expired"
	ReasonTokenFromFuture     Reason = "token_from_future" //nolint:gosec // G101 false positive: a failure-reason code, not a credential
	ReasonDeviceNotTrusted    Reason = "device_not_trusted"
	ReasonAppNotRecognized    Reason = "app_not_recognized"
	ReasonNotLicensed         Reason = "not_licensed"
	ReasonTestingResponse     Reason = "testing_response"
	ReasonTokenReplayed       Reason = "token_replayed"
)

// DeviceLevel is the minimum device integrity the policy requires.
type DeviceLevel int

const (
	LevelBasic DeviceLevel = iota + 1
	LevelDevice
	LevelStrong
)

// ParseDeviceLevel parses "basic", "device" or "strong".
func ParseDeviceLevel(s string) (DeviceLevel, error) {
	switch strings.ToLower(strings.TrimSpace(s)) {
	case "basic":
		return LevelBasic, nil
	case "device", "":
		return LevelDevice, nil
	case "strong":
		return LevelStrong, nil
	default:
		return 0, fmt.Errorf("integrity: unknown device level %q (want basic, device or strong)", s)
	}
}

// verdict is the device level one Google verdict string grants (0 = none).
// MEETS_VIRTUAL_INTEGRITY (an emulator) deliberately grants nothing.
func verdictLevel(v string) DeviceLevel {
	switch v {
	case DeviceBasic:
		return LevelBasic
	case DeviceDevice:
		return LevelDevice
	case DeviceStrong:
		return LevelStrong
	default:
		return 0
	}
}

// Evidence is what Google reported for one decoded token, reduced to the
// fields the policy reads.
type Evidence struct {
	// PackageName is requestDetails.requestPackageName.
	PackageName string
	// RequestHash is requestDetails.requestHash (the value the app passed).
	RequestHash string
	// IssuedAt is requestDetails.timestampMillis.
	IssuedAt       time.Time
	DeviceVerdicts []string
	AppVerdict     string
	AccountVerdict string
	// TestingResponse is testingDetails.isTestingResponse (a statically
	// overridden response given to Play Console testers).
	TestingResponse bool
}

// Policy decides whether Evidence is acceptable.
type Policy struct {
	// AllowedPackages are the accepted applicationIds (release, debug, ...).
	AllowedPackages []string
	// MaxAge is how old a token may be; MaxFutureSkew how far ahead of the
	// server clock its timestamp may be.
	MaxAge        time.Duration
	MaxFutureSkew time.Duration
	// MinDeviceLevel is the lowest accepted device integrity level.
	MinDeviceLevel DeviceLevel
	// RequirePlayRecognized demands appRecognitionVerdict == PLAY_RECOGNIZED
	// (turn off for sideloaded or dev builds).
	RequirePlayRecognized bool
	// RequireLicensed demands accountDetails.appLicensingVerdict == LICENSED
	// (paid or licensed apps only).
	RequireLicensed bool
	// AllowTestingResponses accepts Play Console tester responses. Never in production.
	AllowTestingResponses bool
}

// Validate reports a configuration that could never accept (or always accept) a token.
func (p Policy) Validate() error {
	var errs []error
	if len(p.AllowedPackages) == 0 {
		errs = append(errs, errors.New("at least one allowed package is required"))
	}
	if p.MaxAge <= 0 {
		errs = append(errs, errors.New("max token age must be positive"))
	}
	if p.MaxFutureSkew < 0 {
		errs = append(errs, errors.New("max future skew must not be negative"))
	}
	if p.MinDeviceLevel < LevelBasic || p.MinDeviceLevel > LevelStrong {
		errs = append(errs, errors.New("min device level is not set"))
	}
	return errors.Join(errs...)
}

// PackageAllowed reports whether name is an accepted applicationId.
func (p Policy) PackageAllowed(name string) bool {
	return name != "" && slices.Contains(p.AllowedPackages, name)
}

// ResolvePackage picks the package to decode for: the requested one, or the
// only allowed one when the request leaves it empty. ok is false when the
// package is not allowed or is ambiguous.
func (p Policy) ResolvePackage(requested string) (string, bool) {
	if requested == "" {
		if len(p.AllowedPackages) == 1 {
			return p.AllowedPackages[0], true
		}
		return "", false
	}
	return requested, p.PackageAllowed(requested)
}

// Evaluate applies the policy to evidence for a token requested as
// wantPackage and bound to expectedHash. It returns ReasonNone when accepted.
// Replay is not decided here: it needs state (see the application service).
func (p Policy) Evaluate(e Evidence, wantPackage, expectedHash string, now time.Time) Reason {
	if e.PackageName != wantPackage || !p.PackageAllowed(e.PackageName) {
		return ReasonPackageMismatch
	}
	if !HashesEqual(e.RequestHash, expectedHash) {
		return ReasonTokenNotBound
	}
	if age := now.Sub(e.IssuedAt); age > p.MaxAge {
		return ReasonTokenExpired
	} else if age < -p.MaxFutureSkew {
		return ReasonTokenFromFuture
	}
	if e.TestingResponse && !p.AllowTestingResponses {
		return ReasonTestingResponse
	}
	if !p.deviceOK(e.DeviceVerdicts) {
		return ReasonDeviceNotTrusted
	}
	if p.RequirePlayRecognized && e.AppVerdict != AppPlayRecognized {
		return ReasonAppNotRecognized
	}
	if p.RequireLicensed && e.AccountVerdict != AccountLicensed {
		return ReasonNotLicensed
	}
	return ReasonNone
}

func (p Policy) deviceOK(verdicts []string) bool {
	for _, v := range verdicts {
		if verdictLevel(v) >= p.MinDeviceLevel && verdictLevel(v) != 0 {
			return true
		}
	}
	return false
}

// RequestHash is the binding convention between the Android app and this
// server: base64url (no padding) of SHA-256 over
//
//	"aedst.integrity.v1" LF action LF payload
//
// The app passes it to StandardIntegrityTokenRequest.setRequestHash (43
// characters, well under Play's 500-byte limit); Google signs it into the
// verdict, so a token minted for one action/payload cannot be used for another.
func RequestHash(action string, payload []byte) string {
	h := sha256.New()
	h.Write([]byte(HashPrefix))
	h.Write([]byte{'\n'})
	h.Write([]byte(action))
	h.Write([]byte{'\n'})
	h.Write(payload)
	return base64.RawURLEncoding.EncodeToString(h.Sum(nil))
}

// HashesEqual compares two request hashes in constant time.
func HashesEqual(a, b string) bool {
	return subtle.ConstantTimeCompare([]byte(a), []byte(b)) == 1
}

var actionPattern = regexp.MustCompile(`^[a-z][a-z0-9._-]{0,63}$`)

// ValidAction reports whether action is a legal action name.
func ValidAction(action string) bool { return actionPattern.MatchString(action) }
