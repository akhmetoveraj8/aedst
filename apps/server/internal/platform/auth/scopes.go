package auth

import (
	"slices"
	"strings"

	"github.com/lestrrat-go/jwx/v4/jwt"
)

// OAuth scope claims of an access token: "scope" is a space-delimited string
// (RFC 9068 section 2.2.3, RFC 8693); "scp" is what Okta and Microsoft Entra
// issue, as an array or a space-delimited string.
const (
	claimScope = "scope"
	claimScp   = "scp"
)

// scopesFromToken returns the OAuth scopes granted to the verified token, sorted
// and de-duplicated, from the "scope" and "scp" claims (either or both).
func scopesFromToken(token jwt.Token) []string {
	var scopes []string
	for _, claim := range []string{claimScope, claimScp} {
		if v, ok := token.Field(claim); ok {
			scopes = append(scopes, scopesFromValue(v)...)
		}
	}
	if len(scopes) == 0 {
		return nil
	}
	slices.Sort(scopes)
	return slices.Compact(scopes)
}

// scopesFromValue flattens a scope claim: a space-delimited string or an array
// whose items are scope names (an item with spaces is split too). Anything else
// grants nothing (fail closed).
func scopesFromValue(v any) []string {
	switch vals := v.(type) {
	case string:
		return strings.Fields(vals)
	case []string:
		return slices.Concat(scopeFields(vals)...)
	case []any:
		items := make([]string, 0, len(vals))
		for _, item := range vals {
			if s, ok := item.(string); ok {
				items = append(items, s)
			}
		}
		return slices.Concat(scopeFields(items)...)
	default:
		return nil
	}
}

func scopeFields(items []string) [][]string {
	out := make([][]string, 0, len(items))
	for _, item := range items {
		out = append(out, strings.Fields(item))
	}
	return out
}
