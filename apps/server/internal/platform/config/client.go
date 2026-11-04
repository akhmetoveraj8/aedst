package config

import (
	"bytes"
	"encoding/json"
	"fmt"
	"regexp"
	"slices"
	"strings"

	"golang.org/x/mod/semver"
)

// ClientConfig configures client-version enforcement and the capability
// negotiation answer (docs/content/decisions/0009-api-compatibility-and-client-versioning.md,
// aedst.capabilities.v1.CapabilitiesService).
type ClientConfig struct {
	// MinVersions maps a client platform (web, android, apple, desktop) to
	// the oldest release the server still supports, e.g.
	// "android=1.2.0,apple=1.2.0". Requests from an older, self-identified
	// client are rejected with CLIENT_UPGRADE_REQUIRED. Empty disables the
	// gate; a request that does not identify itself is never rejected.
	MinVersions map[string]string `env:"AEDST_MIN_CLIENT_VERSIONS" envSeparator:"," envKeyValSeparator:"=" envDefault:""`
	// RecommendedVersions is the soft counterpart: the release clients should
	// move to. Nothing is rejected; GetCapabilities reports it and clients show
	// a non-blocking update prompt. Same format as MinVersions.
	RecommendedVersions map[string]string `env:"AEDST_RECOMMENDED_CLIENT_VERSIONS" envSeparator:"," envKeyValSeparator:"=" envDefault:""`
	// FeaturesJSON are operator-controlled feature flags, returned by
	// GetCapabilities: {"new_search":{"enabled":true,"params":{"rollout_percent":"25"}}}.
	// Values are re-read only on restart (a Helm value change rolls the pods).
	FeaturesJSON string `env:"AEDST_FEATURES" envDefault:""`
}

// ClientPlatforms are the values a client may send as the platform half of
// the X-Aedst-Client header.
var ClientPlatforms = []string{"web", "android", "apple", "desktop"}

// Feature is one operator-defined feature flag.
type Feature struct {
	Enabled               bool              `json:"enabled"`
	RequiredClientVersion string            `json:"required_client_version,omitempty"`
	Params                map[string]string `json:"params,omitempty"`
}

const (
	maxFeatures      = 64
	maxFeatureParams = 16
	maxParamLen      = 256
)

// featureName is deliberately dot-free: names with a dot ("media.uploads") are
// reserved for capabilities the server derives from its own configuration.
var featureName = regexp.MustCompile(`^[a-z][a-z0-9_]{0,63}$`)

// normalized trims whitespace and lower-cases platform names so
// "web=1.0.0, Android=1.2.0" (a natural way to write the list) means what it
// looks like instead of failing as an unknown platform " Android".
func (c ClientConfig) normalized() ClientConfig {
	c.MinVersions = normalizeVersions(c.MinVersions)
	c.RecommendedVersions = normalizeVersions(c.RecommendedVersions)
	c.FeaturesJSON = strings.TrimSpace(c.FeaturesJSON)
	return c
}

func normalizeVersions(in map[string]string) map[string]string {
	if len(in) == 0 {
		return in
	}
	out := make(map[string]string, len(in))
	for platform, version := range in {
		out[strings.ToLower(strings.TrimSpace(platform))] = strings.TrimPrefix(strings.TrimSpace(version), "v")
	}
	return out
}

// Features parses AEDST_FEATURES. Validate has already rejected a malformed
// value, so a caller that went through Load never sees the error.
func (c ClientConfig) Features() (map[string]Feature, error) {
	if c.FeaturesJSON == "" {
		return nil, nil
	}
	dec := json.NewDecoder(bytes.NewReader([]byte(c.FeaturesJSON)))
	dec.DisallowUnknownFields()
	var out map[string]Feature
	if err := dec.Decode(&out); err != nil {
		return nil, fmt.Errorf("AEDST_FEATURES: %w", err)
	}
	return out, nil
}

func (c Config) validateClient(bad func(string, ...any)) {
	for _, env := range []struct {
		name     string
		versions map[string]string
	}{
		{"AEDST_MIN_CLIENT_VERSIONS", c.Client.MinVersions},
		{"AEDST_RECOMMENDED_CLIENT_VERSIONS", c.Client.RecommendedVersions},
	} {
		for platform, version := range env.versions {
			if !slices.Contains(ClientPlatforms, platform) {
				bad("%s: unknown platform %q (want one of %v)", env.name, platform, ClientPlatforms)
			}
			if !semver.IsValid("v" + version) {
				bad("%s: %q is not a semantic version for %s", env.name, version, platform)
			}
		}
	}
	for platform, rec := range c.Client.RecommendedVersions {
		if min, ok := c.Client.MinVersions[platform]; ok && semver.IsValid("v"+min) && semver.IsValid("v"+rec) && semver.Compare("v"+rec, "v"+min) < 0 {
			bad("AEDST_RECOMMENDED_CLIENT_VERSIONS: %s %s is below the minimum %s", platform, rec, min)
		}
	}

	features, err := c.Client.Features()
	if err != nil {
		bad("%v", err)
		return
	}
	if len(features) > maxFeatures {
		bad("AEDST_FEATURES: at most %d features", maxFeatures)
	}
	for name, f := range features {
		if !featureName.MatchString(name) {
			bad("AEDST_FEATURES: feature name %q must match %s", name, featureName)
		}
		if v := f.RequiredClientVersion; v != "" && !semver.IsValid("v"+strings.TrimPrefix(v, "v")) {
			bad("AEDST_FEATURES: feature %q required_client_version %q is not a semantic version", name, v)
		}
		if len(f.Params) > maxFeatureParams {
			bad("AEDST_FEATURES: feature %q has more than %d params", name, maxFeatureParams)
		}
		for k, v := range f.Params {
			if k == "" || len(k) > 64 || len(v) > maxParamLen {
				bad("AEDST_FEATURES: feature %q has an empty or oversized param key/value", name)
			}
		}
	}
}
