// Package buildinfo reports which build is running. Release images set Version
// with -ldflags "-X github.com/aedst/server/internal/platform/buildinfo.Version=1.4.2";
// without it the VCS revision stamped by `go build` is used, and finally "dev".
package buildinfo

import "runtime/debug"

// Version is set at link time for releases.
var Version = ""

// Get returns the build's version string.
func Get() string {
	return resolve(Version, debug.ReadBuildInfo)
}

func resolve(linked string, read func() (*debug.BuildInfo, bool)) string {
	if linked != "" {
		return linked
	}
	if info, ok := read(); ok {
		for _, s := range info.Settings {
			if s.Key == "vcs.revision" && s.Value != "" {
				return s.Value[:min(len(s.Value), 12)]
			}
		}
	}
	return "dev"
}
