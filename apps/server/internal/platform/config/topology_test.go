package config

import (
	"strings"
	"testing"
)

func TestRemoteUnits(t *testing.T) {
	got := remoteUnits([]string{
		"AEDST_MODULE_TASKS_URL=http://tasks:8080",
		"AEDST_MODULE_SOCIAL__LIKE_URL=https://like.internal",
		"AEDST_MODULES=media",        // the enabled list, not a URL
		"AEDST_MODULE_EMPTY_URL=",    // empty = unset
		"AEDST_DATABASE_URL_TASKS=x", // another family
		"AEDST_MODULE__URL=http://x", // no name
	})
	want := map[string]string{"tasks": "http://tasks:8080", "social/like": "https://like.internal"}
	if len(got) != len(want) {
		t.Fatalf("remoteUnits = %v, want %v", got, want)
	}
	for k, v := range want {
		if got[k] != v {
			t.Errorf("%s = %q, want %q", k, got[k], v)
		}
	}
}

func TestTopologyValidate(t *testing.T) {
	cases := map[string]struct {
		in   TopologyConfig
		want string // "" = valid
	}{
		"monolith":              {TopologyConfig{}, ""},
		"modules and a feature": {TopologyConfig{Enabled: []string{"chat", "social/like"}}, ""},
		"upper case":            {TopologyConfig{Enabled: []string{"Chat"}}, "not a unit name"},
		"two slashes":           {TopologyConfig{Enabled: []string{"a/b/c"}}, "not a unit name"},
		"empty segment":         {TopologyConfig{Enabled: []string{"social/"}}, "not a unit name"},
		"relative url":          {TopologyConfig{Remote: map[string]string{"tasks": "tasks:8080"}}, "absolute http(s) URL"},
		"file url":              {TopologyConfig{Remote: map[string]string{"tasks": "file:///x"}}, "absolute http(s) URL"},
		"good url":              {TopologyConfig{Remote: map[string]string{"tasks": "http://tasks:8080"}}, ""},
		"hosted and remote":     {TopologyConfig{Enabled: []string{"tasks"}, Remote: map[string]string{"tasks": "http://t"}}, "pick one"},
		"bad remote name":       {TopologyConfig{Remote: map[string]string{"Bad": "http://t"}}, "not a unit name"},
	}
	for name, tc := range cases {
		t.Run(name, func(t *testing.T) {
			err := tc.in.Validate()
			switch {
			case tc.want == "" && err != nil:
				t.Fatalf("unexpected error: %v", err)
			case tc.want != "" && (err == nil || !strings.Contains(err.Error(), tc.want)):
				t.Fatalf("err = %v, want it to contain %q", err, tc.want)
			}
		})
	}
}
