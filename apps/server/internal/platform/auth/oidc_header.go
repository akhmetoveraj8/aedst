package auth

import (
	"errors"
	"fmt"
	"slices"
	"strings"

	"github.com/lestrrat-go/jwx/v4/jws"
	"github.com/lestrrat-go/jwx/v4/jwt"
)

// checkHeader rejects a token whose JOSE header is not one we accept BEFORE any
// key lookup:
//   - alg must be on the allow-list, so "none" and HS* (algorithm confusion: a
//     public key used as an HMAC secret) never reach verification;
//   - typ must be one of the configured access-token types (RFC 9068 "at+jwt",
//     or "JWT" for providers that do not set it). A missing typ is rejected too:
//     an ID token or a JWT minted for another purpose is not an access token.
func (v *OIDCVerifier) checkHeader(raw string) error {
	msg, err := jws.Parse([]byte(raw))
	if err != nil {
		return fmt.Errorf("auth: malformed token: %w", err)
	}
	sigs := msg.Signatures()
	if len(sigs) != 1 {
		return errors.New("auth: token must have exactly one signature")
	}
	headers := sigs[0].ProtectedHeaders()
	alg, ok := headers.Algorithm()
	if !ok || !slices.ContainsFunc(v.algs, func(a string) bool { return strings.EqualFold(a, alg.String()) }) {
		return fmt.Errorf("auth: token algorithm %q not allowed", alg.String())
	}
	typ, _ := headers.Type()
	if !slices.ContainsFunc(v.cfg.TokenTypes, func(allowed string) bool { return sameTokenType(allowed, typ) }) {
		return fmt.Errorf("auth: token type %q not allowed (not an access token)", typ)
	}
	return nil
}

// sameTokenType compares JOSE `typ` values as RFC 7515 §4.1.9 prescribes:
// case-insensitive, with an optional "application/" prefix.
func sameTokenType(a, b string) bool {
	norm := func(s string) string {
		s = strings.ToLower(strings.TrimSpace(s))
		return strings.TrimPrefix(s, "application/")
	}
	return a != "" && b != "" && norm(a) == norm(b)
}

// idTokenOnlyClaims appear in OpenID Connect ID tokens (core §2) and never in an
// access token: a token carrying one is an ID token, even when its audience is
// the API's project (ZITADEL adds the project audience on request) and its
// signature is valid.
var idTokenOnlyClaims = []string{"nonce", "at_hash", "c_hash"}

// nonAccessTypClaims are values of the payload `typ` claim that Keycloak sets on
// tokens that are not access tokens (an access token's is "Bearer").
var nonAccessTypClaims = []string{"id", "refresh", "offline", "logout"}

// rejectNonAccessToken fails closed on an ID token, refresh token or logout
// token presented as an access token. RFC 9068 §4: resource servers MUST NOT
// accept ID tokens.
func rejectNonAccessToken(token jwt.Token) error {
	for _, c := range idTokenOnlyClaims {
		if _, ok := token.Field(c); ok {
			return fmt.Errorf("auth: token carries the ID-token claim %q, not an access token", c)
		}
	}
	if typ, ok := token.Field("typ"); ok {
		if s, isString := typ.(string); isString && slices.Contains(nonAccessTypClaims, strings.ToLower(s)) {
			return fmt.Errorf("auth: token typ claim %q is not an access token", s)
		}
	}
	return nil
}
