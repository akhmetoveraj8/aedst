package auth

import (
	"encoding/json"
	"strings"
	"testing"

	"github.com/lestrrat-go/jwx/v4/jwt"
)

// Claims come from a token whose signature is already valid, but the IdP is
// still an outside party: odd claim shapes must neither panic nor let an ID
// token through as an access token.

func FuzzRolesFromValue(f *testing.F) {
	f.Add(`["admin","user"]`, "")
	f.Add(`{"admin":{"org1":"x"},"user":{}}`, "org1")
	f.Add(`"admin support"`, "")
	f.Add(`[1,null,{"a":[]}]`, "o")
	f.Fuzz(func(t *testing.T, claim, org string) {
		var v any
		if json.Unmarshal([]byte(claim), &v) != nil {
			return
		}
		roles := rolesFromValue(v, org)
		if m, ok := v.(map[string]any); ok && org != "" {
			for _, r := range roles {
				if orgs, isMap := m[r].(map[string]any); !isMap || !hasKey(orgs, org) {
					t.Fatalf("role %q granted without organisation %q", r, org)
				}
			}
		}
	})
}

func hasKey(m map[string]any, k string) bool { _, ok := m[k]; return ok }

func FuzzRejectNonAccessToken(f *testing.F) {
	f.Add(`{"sub":"u","roles":["a"]}`)
	f.Add(`{"sub":"u","nonce":"n"}`)
	f.Add(`{"sub":"u","typ":"ID"}`)
	f.Add(`{"realm_access":{"roles":["x"]}}`)
	f.Fuzz(func(t *testing.T, payload string) {
		token, err := jwt.ParseInsecure([]byte(payload))
		if err != nil {
			return
		}
		rejectErr := rejectNonAccessToken(token)
		for _, c := range idTokenOnlyClaims {
			if _, ok := token.Field(c); ok && rejectErr == nil {
				t.Fatalf("token with ID-token claim %q accepted: %s", c, payload)
			}
		}
		for _, claim := range []string{"roles", "realm_access.roles", "a.b.c", ""} {
			_ = rolesFromToken(token, claim, "")
		}
	})
}

func FuzzSameTokenType(f *testing.F) {
	f.Add("at+jwt", "Application/AT+JWT")
	f.Add("", "")
	f.Fuzz(func(t *testing.T, a, b string) {
		if sameTokenType(a, b) != sameTokenType(b, a) {
			t.Fatalf("not symmetric: %q %q", a, b)
		}
		if sameTokenType(a, b) && (a == "" || b == "") {
			t.Fatal("an empty typ matched")
		}
	})
}

// FuzzCheckHeader feeds arbitrary compact tokens to the JWS header gate.
func FuzzCheckHeader(f *testing.F) {
	f.Add("eyJhbGciOiJFUzI1NiIsInR5cCI6ImF0K2p3dCJ9.e30.c2ln")
	f.Add("eyJhbGciOiJub25lIn0.e30.")
	f.Add("a.b")
	f.Add("")
	v := &OIDCVerifier{cfg: OIDCConfig{TokenTypes: []string{"at+jwt"}}, algs: []string{"ES256"}}
	f.Fuzz(func(t *testing.T, raw string) {
		if err := v.checkHeader(raw); err == nil && strings.Count(raw, ".") != 2 {
			t.Fatalf("accepted a token that is not a compact JWS: %q", raw)
		}
	})
}
