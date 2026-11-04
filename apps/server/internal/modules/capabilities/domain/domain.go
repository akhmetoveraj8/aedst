// Package domain holds the capability model: what a client may learn about the
// server before it signs in. It has no dependencies beyond semver parsing.
package domain

import "golang.org/x/mod/semver"

// UpdateStatus is how a client release compares with the support policy.
type UpdateStatus int

const (
	// StatusUnknown: the caller did not identify itself or no policy covers its platform.
	StatusUnknown UpdateStatus = iota
	StatusCurrent
	// StatusRecommended: allowed, but older than the recommended release.
	StatusRecommended
)

// ClientVersions is the support window of one platform (semver, no "v"; empty = unset).
type ClientVersions struct {
	Minimum     string
	Recommended string
}

// Feature is one switchable capability. A feature that is absent is off.
type Feature struct {
	Enabled bool
	// RequiredClientVersion (semver, empty = none): clients older than it hide the feature.
	RequiredClientVersion string
	Params                map[string]string
}

// Capabilities is the full answer.
type Capabilities struct {
	ServerVersion string
	Clients       map[string]ClientVersions
	Features      map[string]Feature
	Status        UpdateStatus
}

// StatusOf classifies version (with a leading "v", as semver requires) against
// one platform's window. A release below the minimum is also reported as
// StatusRecommended: the version gate rejects those before they get here, but
// a caller that has no gate in front (a test, another transport) must not be
// told it is current.
func StatusOf(version string, window ClientVersions) UpdateStatus {
	if !semver.IsValid(version) {
		return StatusUnknown
	}
	for _, bound := range []string{window.Minimum, window.Recommended} {
		if bound != "" && semver.Compare(version, "v"+bound) < 0 {
			return StatusRecommended
		}
	}
	if window.Minimum == "" && window.Recommended == "" {
		return StatusUnknown
	}
	return StatusCurrent
}
