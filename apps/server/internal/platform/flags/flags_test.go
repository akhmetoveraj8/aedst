package flags_test

import (
	"context"
	"testing"

	"github.com/open-feature/go-sdk/openfeature/memprovider"

	"github.com/aedst/server/internal/platform/flags"
)

func newClient(t *testing.T, domain string, from map[string]memprovider.InMemoryFlag) *flags.Client {
	t.Helper()
	c, err := flags.New(domain, memprovider.NewInMemoryProvider(from))
	if err != nil {
		t.Fatal(err)
	}
	return c
}

func TestClient_EvaluatesFromTheProvider(t *testing.T) {
	c := newClient(t, "test-eval", map[string]memprovider.InMemoryFlag{
		"search-enabled": {Key: "search-enabled", State: memprovider.Enabled, DefaultVariant: "on", Variants: map[string]any{"on": true, "off": false}},
		"theme":          {Key: "theme", State: memprovider.Enabled, DefaultVariant: "dark", Variants: map[string]any{"dark": "dark"}},
	})
	ctx := context.Background()
	if !c.Bool(ctx, "search-enabled", false, "user-1") {
		t.Fatal("search-enabled = false; want the provider's variant (true)")
	}
	if got := c.String(ctx, "theme", "light", ""); got != "dark" {
		t.Fatalf("theme = %q; want dark", got)
	}
}

func TestClient_UnknownOrDisabledFlagReturnsTheDefault(t *testing.T) {
	c := newClient(t, "test-default", map[string]memprovider.InMemoryFlag{
		"off": {Key: "off", State: memprovider.Disabled, DefaultVariant: "on", Variants: map[string]any{"on": true}},
	})
	ctx := context.Background()
	if !c.Bool(ctx, "missing", true, "") {
		t.Fatal("unknown flag must return the caller's default (true)")
	}
	if c.Bool(ctx, "off", false, "") {
		t.Fatal("disabled flag must return the caller's default (false)")
	}
}

func TestStatic_AlwaysReturnsTheDefault(t *testing.T) {
	var f flags.Flags = flags.Static{}
	if !f.Bool(context.Background(), "x", true, "") || f.String(context.Background(), "y", "d", "") != "d" {
		t.Fatal("Static must return defaults")
	}
}
