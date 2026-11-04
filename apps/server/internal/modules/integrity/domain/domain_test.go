package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/integrity/domain"
)

var now = time.Date(2026, 10, 8, 12, 0, 0, 0, time.UTC)

const pkg = "com.aedst.android"

func policy() domain.Policy {
	return domain.Policy{
		AllowedPackages:       []string{pkg, "com.aedst.android.debug"},
		MaxAge:                5 * time.Minute,
		MaxFutureSkew:         30 * time.Second,
		MinDeviceLevel:        domain.LevelDevice,
		RequirePlayRecognized: true,
	}
}

func goodEvidence(hash string) domain.Evidence {
	return domain.Evidence{
		PackageName:    pkg,
		RequestHash:    hash,
		IssuedAt:       now.Add(-10 * time.Second),
		DeviceVerdicts: []string{domain.DeviceDevice},
		AppVerdict:     domain.AppPlayRecognized,
		AccountVerdict: domain.AccountLicensed,
	}
}

func TestRequestHash_IsStableBase64URLSHA256(t *testing.T) {
	h := domain.RequestHash("login", []byte("nonce-1"))
	if len(h) != 43 || strings.ContainsAny(h, "+/=") {
		t.Fatalf("hash %q: want 43 chars of unpadded base64url", h)
	}
	if h != domain.RequestHash("login", []byte("nonce-1")) {
		t.Error("hash is not deterministic")
	}
	if h == domain.RequestHash("purchase", []byte("nonce-1")) || h == domain.RequestHash("login", []byte("nonce-2")) {
		t.Error("hash must depend on both action and payload")
	}
	// Pinned vector: clients (Kotlin/Swift) must compute exactly this.
	// SHA-256("aedst.integrity.v1\nlogin\nnonce-1"), base64url without padding.
	if want := "UkAvAJYvJMZg2YwnrmEJU958ycebRjwq-tR0Fxs6at8"; h != want {
		t.Errorf("RequestHash = %s, want %s", h, want)
	}
}

func TestEvaluate(t *testing.T) {
	hash := domain.RequestHash("login", []byte("n"))
	tests := []struct {
		name   string
		mutate func(*domain.Evidence, *domain.Policy)
		want   domain.Reason
	}{
		{"accepted", func(*domain.Evidence, *domain.Policy) {}, domain.ReasonNone},
		{"strong implies device", func(e *domain.Evidence, _ *domain.Policy) { e.DeviceVerdicts = []string{domain.DeviceStrong} }, domain.ReasonNone},
		{"allowed package but not the requested one", func(e *domain.Evidence, _ *domain.Policy) { e.PackageName = "com.aedst.android.debug" }, domain.ReasonPackageMismatch}, // wantPackage is pkg
		{"other package", func(e *domain.Evidence, _ *domain.Policy) { e.PackageName = "com.evil.app" }, domain.ReasonPackageMismatch},
		{"empty package", func(e *domain.Evidence, _ *domain.Policy) { e.PackageName = "" }, domain.ReasonPackageMismatch},
		{"unbound token", func(e *domain.Evidence, _ *domain.Policy) { e.RequestHash = domain.RequestHash("login", []byte("x")) }, domain.ReasonTokenNotBound},
		{"no hash", func(e *domain.Evidence, _ *domain.Policy) { e.RequestHash = "" }, domain.ReasonTokenNotBound},
		{"expired", func(e *domain.Evidence, _ *domain.Policy) { e.IssuedAt = now.Add(-5*time.Minute - time.Second) }, domain.ReasonTokenExpired},
		{"exactly at max age", func(e *domain.Evidence, _ *domain.Policy) { e.IssuedAt = now.Add(-5 * time.Minute) }, domain.ReasonNone},
		{"within future skew", func(e *domain.Evidence, _ *domain.Policy) { e.IssuedAt = now.Add(20 * time.Second) }, domain.ReasonNone},
		{"from the future", func(e *domain.Evidence, _ *domain.Policy) { e.IssuedAt = now.Add(31 * time.Second) }, domain.ReasonTokenFromFuture},
		{"basic only", func(e *domain.Evidence, _ *domain.Policy) { e.DeviceVerdicts = []string{domain.DeviceBasic} }, domain.ReasonDeviceNotTrusted},
		{"basic allowed by config", func(e *domain.Evidence, p *domain.Policy) {
			e.DeviceVerdicts = []string{domain.DeviceBasic}
			p.MinDeviceLevel = domain.LevelBasic
		}, domain.ReasonNone},
		{"emulator never counts", func(e *domain.Evidence, p *domain.Policy) {
			e.DeviceVerdicts = []string{domain.DeviceVirtual}
			p.MinDeviceLevel = domain.LevelBasic
		}, domain.ReasonDeviceNotTrusted},
		{"no device verdict", func(e *domain.Evidence, _ *domain.Policy) { e.DeviceVerdicts = nil }, domain.ReasonDeviceNotTrusted},
		{"strong required, device given", func(_ *domain.Evidence, p *domain.Policy) { p.MinDeviceLevel = domain.LevelStrong }, domain.ReasonDeviceNotTrusted},
		{"sideload", func(e *domain.Evidence, _ *domain.Policy) { e.AppVerdict = domain.AppUnrecognizedVersion }, domain.ReasonAppNotRecognized},
		{"sideload allowed by config", func(e *domain.Evidence, p *domain.Policy) {
			e.AppVerdict = domain.AppUnrecognizedVersion
			p.RequirePlayRecognized = false
		}, domain.ReasonNone},
		{"unlicensed ignored by default", func(e *domain.Evidence, _ *domain.Policy) { e.AccountVerdict = domain.AccountUnlicensed }, domain.ReasonNone},
		{"unlicensed when required", func(e *domain.Evidence, p *domain.Policy) {
			e.AccountVerdict = domain.AccountUnlicensed
			p.RequireLicensed = true
		}, domain.ReasonNotLicensed},
		{"testing response", func(e *domain.Evidence, _ *domain.Policy) { e.TestingResponse = true }, domain.ReasonTestingResponse},
		{"testing response allowed", func(e *domain.Evidence, p *domain.Policy) {
			e.TestingResponse = true
			p.AllowTestingResponses = true
		}, domain.ReasonNone},
	}
	for _, tt := range tests {
		t.Run(tt.name, func(t *testing.T) {
			e, p := goodEvidence(hash), policy()
			tt.mutate(&e, &p)
			if got := p.Evaluate(e, pkg, hash, now); got != tt.want {
				t.Fatalf("Evaluate = %q, want %q", got, tt.want)
			}
		})
	}
}

func TestResolvePackage(t *testing.T) {
	p := policy()
	if _, ok := p.ResolvePackage(""); ok {
		t.Error("empty package with two allowed must be ambiguous")
	}
	if got, ok := p.ResolvePackage("com.aedst.android.debug"); !ok || got != "com.aedst.android.debug" {
		t.Errorf("allowed package = %q, %v", got, ok)
	}
	if _, ok := p.ResolvePackage("com.evil.app"); ok {
		t.Error("unlisted package accepted")
	}
	p.AllowedPackages = []string{pkg}
	if got, ok := p.ResolvePackage(""); !ok || got != pkg {
		t.Errorf("single allowed package default = %q, %v", got, ok)
	}
}

func TestPolicyValidateAndParse(t *testing.T) {
	if err := policy().Validate(); err != nil {
		t.Fatalf("valid policy: %v", err)
	}
	if err := (domain.Policy{}).Validate(); err == nil {
		t.Fatal("empty policy must be invalid")
	}
	for in, want := range map[string]domain.DeviceLevel{"basic": domain.LevelBasic, "DEVICE": domain.LevelDevice, "strong": domain.LevelStrong, "": domain.LevelDevice} {
		if got, err := domain.ParseDeviceLevel(in); err != nil || got != want {
			t.Errorf("ParseDeviceLevel(%q) = %v, %v", in, got, err)
		}
	}
	if _, err := domain.ParseDeviceLevel("paranoid"); err == nil {
		t.Error("unknown level accepted")
	}
	if !domain.ValidAction("login") || !domain.ValidAction("pay.checkout-1") || domain.ValidAction("Login") || domain.ValidAction("") || domain.ValidAction("a b") {
		t.Error("ValidAction mismatch")
	}
}
