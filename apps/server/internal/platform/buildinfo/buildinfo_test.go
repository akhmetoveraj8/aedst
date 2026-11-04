package buildinfo

import (
	"runtime/debug"
	"testing"
)

func TestResolve(t *testing.T) {
	withRev := func() (*debug.BuildInfo, bool) {
		return &debug.BuildInfo{Settings: []debug.BuildSetting{{Key: "vcs.revision", Value: "0123456789abcdef0123"}}}, true
	}
	none := func() (*debug.BuildInfo, bool) { return nil, false }

	for name, tc := range map[string]struct {
		linked string
		read   func() (*debug.BuildInfo, bool)
		want   string
	}{
		"linked version wins":     {"1.4.2", withRev, "1.4.2"},
		"vcs revision, shortened": {"", withRev, "0123456789ab"},
		"nothing known":           {"", none, "dev"},
	} {
		if got := resolve(tc.linked, tc.read); got != tc.want {
			t.Errorf("%s: resolve = %q, want %q", name, got, tc.want)
		}
	}
}
