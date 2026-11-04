//go:build integration

package main

import (
	"sync"
	"testing"

	"github.com/aedst/server/internal/platform/auth/authtest"
)

// The server under test is a pure OIDC resource server (ADR-0019): every
// integration test authenticates with a token from this in-process provider.
// One instance is shared by all servers of the test binary, so replicas accept
// each other's tokens. It lives until the binary exits.
var (
	sharedIdP     *authtest.IdP
	sharedIdPOnce sync.Once
)

const testAudience = authtest.Audience

func idp(t *testing.T) *authtest.IdP {
	t.Helper()
	sharedIdPOnce.Do(func() { sharedIdP = authtest.New(t) })
	return sharedIdP
}
