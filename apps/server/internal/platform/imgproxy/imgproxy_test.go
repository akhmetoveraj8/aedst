package imgproxy

import (
	"strings"
	"testing"
	"time"
)

// Vector from docs.imgproxy.net/usage/signing_url (key "secret", salt "hello").
func TestSignMatchesImgproxyDocsVector(t *testing.T) {
	s, err := New(Config{BaseURL: "https://img.example.com", Bucket: "b", KeyHex: "736563726574", SaltHex: "68656C6C6F"})
	if err != nil {
		t.Fatal(err)
	}
	got := s.sign("/rs:fill:300:400:0/g:sm/aHR0cDovL2V4YW1w/bGUuY29tL2ltYWdl/cy9jdXJpb3NpdHku/anBn.png")
	if want := "oKfUtW34Dvo2BGQehJFR4Nr0_rIjOtdtzJ3QFsUcXH8"; got != want {
		t.Fatalf("signature = %s, want %s", got, want)
	}
}

func TestURL(t *testing.T) {
	s, err := New(Config{BaseURL: "https://img.example.com/", Bucket: "aedst", KeyHex: "736563726574", SaltHex: "68656C6C6F", TTL: time.Hour})
	if err != nil {
		t.Fatal(err)
	}
	s.now = func() time.Time { return time.Unix(7200+10, 0) }
	u := s.URL("media/o/i/original", Avatar256)
	// signature segment, then the signed path (expiry rounded: (7210/3600+2)*3600 = 14400).
	if !strings.HasPrefix(u, "https://img.example.com/") || !strings.HasSuffix(u, "/preset:avatar_256/exp:14400/plain/s3://aedst/media/o/i/original") {
		t.Fatalf("url = %s", u)
	}
	if s.URL("media/o/i/original", Avatar256) != u {
		t.Error("URLs must be stable within an expiry window (CDN cacheable)")
	}
	if u2 := s.URL("media/o/i/other", Avatar256); u2 == u {
		t.Error("different objects must differ")
	}
}

func TestNewValidates(t *testing.T) {
	base := Config{BaseURL: "https://i.example.com", Bucket: "b", KeyHex: "00ff", SaltHex: "00ff"}
	if _, err := New(base); err != nil {
		t.Fatal(err)
	}
	for name, mut := range map[string]func(*Config){
		"url":    func(c *Config) { c.BaseURL = "img.example.com" },
		"bucket": func(c *Config) { c.Bucket = "" },
		"key":    func(c *Config) { c.KeyHex = "zz" },
		"salt":   func(c *Config) { c.SaltHex = "" },
	} {
		c := base
		mut(&c)
		if _, err := New(c); err == nil {
			t.Errorf("%s: want error", name)
		}
	}
}

func TestNilSignerIsDisabled(t *testing.T) {
	var s *Signer
	if s.Enabled() || s.URL("k", Thumb64) != "" {
		t.Fatal("nil signer must be disabled")
	}
}
