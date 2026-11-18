package config

import (
	"fmt"
	"strings"
	"testing"
)

func TestServiceIdentityValidation(t *testing.T) {
	cases := []struct {
		name string
		env  Env
		cfg  ServiceIdentityConfig
		want string // substring of the problem, "" = valid
	}{
		{"unset is valid", EnvDevelopment, ServiceIdentityConfig{}, ""},
		{"complete", EnvProduction, ServiceIdentityConfig{TokenURL: "https://idp.example/token", ClientID: "a", ClientSecret: "b"}, ""},
		{"secret without url", EnvDevelopment, ServiceIdentityConfig{ClientSecret: "b"}, "need AEDST_SERVICE_IDENTITY_TOKEN_URL"},
		{"url without client", EnvDevelopment, ServiceIdentityConfig{TokenURL: "https://idp.example/token"}, "requires AEDST_SERVICE_IDENTITY_CLIENT_ID"},
		{"plain http in production", EnvProduction, ServiceIdentityConfig{TokenURL: "http://idp.example/token", ClientID: "a", ClientSecret: "b"}, "must use https"},
		{"plain http in development", EnvDevelopment, ServiceIdentityConfig{TokenURL: "http://localhost:8080/token", ClientID: "a", ClientSecret: "b"}, ""},
		{"empty scope", EnvDevelopment, ServiceIdentityConfig{TokenURL: "https://idp.example/token", ClientID: "a", ClientSecret: "b", Scopes: []string{"openid", ""}}, "empty scope"},
	}
	for _, c := range cases {
		t.Run(c.name, func(t *testing.T) {
			var problems []string
			Config{Env: c.env, ServiceIdentity: c.cfg}.validateServiceIdentity(func(f string, a ...any) {
				problems = append(problems, strings.TrimSpace(fmt.Sprintf(f, a...)))
			})
			got := strings.Join(problems, "; ")
			if c.want == "" && got != "" || c.want != "" && !strings.Contains(got, c.want) {
				t.Fatalf("problems = %q, want %q", got, c.want)
			}
		})
	}
}
