package config

import "regexp"

// AppAttestConfig configures Apple App Attest verification (modules/appattest).
// Disabled by default: AppAttestService answers FAILED_PRECONDITION and nothing
// is verified.
type AppAttestConfig struct {
	Enabled bool `env:"AEDST_APPATTEST_ENABLED" envDefault:"false"`
	// TeamID is the 10-character Apple Developer Team ID (the App ID prefix).
	TeamID string `env:"AEDST_APPATTEST_TEAM_ID" envDefault:""`
	// AllowedBundleIDs are the accepted bundle identifiers; the App ID checked
	// against the attestation is "<TeamID>.<bundle id>".
	AllowedBundleIDs []string `env:"AEDST_APPATTEST_ALLOWED_BUNDLE_IDS" envSeparator:"," envDefault:""`
	// AllowDevelopment accepts keys from the development App Attest
	// environment (builds run from Xcode). Rejected in staging and production.
	AllowDevelopment bool `env:"AEDST_APPATTEST_ALLOW_DEVELOPMENT" envDefault:"false"`
	// RateLimitPerMinute is the per-user budget for CreateChallenge + Enroll
	// (they are rare: once per install). 0 disables.
	RateLimitPerMinute int `env:"AEDST_APPATTEST_RATE_LIMIT_PER_MINUTE" envDefault:"10"`
	// AssertionRateLimitPerMinute is the per-user budget for VerifyAssertion. 0 disables.
	AssertionRateLimitPerMinute int `env:"AEDST_APPATTEST_ASSERTION_RATE_LIMIT_PER_MINUTE" envDefault:"120"`
	// KeyRetentionDays purges keys not used for this long (the app re-enrolls).
	KeyRetentionDays int `env:"AEDST_APPATTEST_KEY_RETENTION_DAYS" envDefault:"365"`
}

var appAttestTeamID = regexp.MustCompile(`^[A-Z0-9]{10}$`)

func (c Config) validateAppAttest(bad func(string, ...any)) {
	a := c.AppAttest
	if !a.Enabled {
		return
	}
	if !appAttestTeamID.MatchString(a.TeamID) {
		bad("AEDST_APPATTEST_ENABLED requires AEDST_APPATTEST_TEAM_ID (10 upper-case letters or digits)")
	}
	if len(a.AllowedBundleIDs) == 0 {
		bad("AEDST_APPATTEST_ENABLED requires AEDST_APPATTEST_ALLOWED_BUNDLE_IDS")
	}
	if a.RateLimitPerMinute < 0 || a.AssertionRateLimitPerMinute < 0 || a.KeyRetentionDays <= 0 {
		bad("AEDST_APPATTEST_*_RATE_LIMIT_PER_MINUTE must not be negative and AEDST_APPATTEST_KEY_RETENTION_DAYS must be positive")
	}
	if c.Env.IsDeployed() && a.AllowDevelopment {
		bad("AEDST_APPATTEST_ALLOW_DEVELOPMENT must be false in %s", c.Env)
	}
}
