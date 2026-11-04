// Package goldentest pins the wire format of integration events. Each event
// version has a fixture <module>/api/testdata/<Event>.v<N>.json; the test decodes
// it strictly into the payload struct and encodes it back, and the bytes must be
// identical. A rename, retype or removal fails the decode; an added field fails the
// diff until the fixture shows it (additive change within a version); a breaking
// change must become a new version with a NEW fixture, while the older fixtures
// must keep decoding.
//
// Test-only helper: import it from *_test.go files of a module's api package.
package goldentest

import (
	"bytes"
	"encoding/json"
	"fmt"
	"os"
	"path/filepath"
	"regexp"
	"strings"
	"testing"
)

// Case describes one published event.
type Case struct {
	// Type is the event type constant, e.g. "tasks.v1.TaskCreated".
	Type string
	// Version is the event version constant; the fixture for it must exist.
	Version int
	// New returns a pointer to an empty payload struct.
	New func() any
}

var fixtureName = regexp.MustCompile(`^(\w+)\.v(\d+)\.json$`)

// Name is the fixture basename of an event type: the segment after the last dot.
func Name(eventType string) string {
	return eventType[strings.LastIndex(eventType, ".")+1:]
}

// Check verifies every case against dir (the module's api/testdata).
func Check(t *testing.T, dir string, cases []Case) {
	t.Helper()
	for _, p := range Problems(dir, cases) {
		t.Error(p)
	}
}

// Problems is Check without *testing.T (so the checker itself can be tested).
func Problems(dir string, cases []Case) []string {
	var problems []string
	add := func(format string, args ...any) { problems = append(problems, fmt.Sprintf(format, args...)) }
	known := map[string]Case{}
	for _, c := range cases {
		known[Name(c.Type)] = c
		path := filepath.Join(dir, fmt.Sprintf("%s.v%d.json", Name(c.Type), c.Version))
		if err := roundTrip(path, c.New); err != nil {
			add("%s v%d: %v", c.Type, c.Version, err)
		}
	}
	entries, err := os.ReadDir(dir)
	if err != nil {
		return append(problems, fmt.Sprintf("read %s: %v", dir, err))
	}
	for _, e := range entries {
		m := fixtureName.FindStringSubmatch(e.Name())
		if m == nil {
			add("%s: fixture name must be <Event>.v<N>.json", e.Name())
			continue
		}
		c, ok := known[m[1]]
		if !ok {
			add("%s: no event %s is registered in the golden test", e.Name(), m[1])
			continue
		}
		var v int
		_, _ = fmt.Sscan(m[2], &v)
		switch {
		case v > c.Version:
			add("%s: fixture is for a version above the published %d", e.Name(), c.Version)
		case v < c.Version:
			// An older version stays decodable by the current struct (fields are only added).
			raw, err := os.ReadFile(filepath.Join(dir, e.Name())) //nolint:gosec // G304: a fixture inside the module's own testdata
			if err != nil {
				add("%s: %v", e.Name(), err)
			} else if err := json.Unmarshal(raw, c.New()); err != nil {
				add("%s: older version no longer decodes: %v", e.Name(), err)
			}
		}
	}
	return problems
}

// roundTrip decodes the fixture strictly and encodes it back; the result must
// equal the fixture byte for byte (trailing newline ignored).
func roundTrip(path string, newPayload func() any) error {
	want, err := os.ReadFile(path) //nolint:gosec // G304: a fixture inside the module's own testdata
	if err != nil {
		return fmt.Errorf("missing fixture %s (a new event version needs a new fixture): %w", filepath.Base(path), err)
	}
	payload := newPayload()
	dec := json.NewDecoder(bytes.NewReader(want))
	dec.DisallowUnknownFields()
	if err := dec.Decode(payload); err != nil {
		return fmt.Errorf("decode %s: %w", filepath.Base(path), err)
	}
	got, err := json.MarshalIndent(payload, "", "  ")
	if err != nil {
		return fmt.Errorf("encode: %w", err)
	}
	if !bytes.Equal(bytes.TrimSpace(got), bytes.TrimSpace(want)) {
		return fmt.Errorf("%s differs after decode -> encode (update the fixture only for an additive change):\n--- fixture\n%s\n--- encoded\n%s",
			filepath.Base(path), bytes.TrimSpace(want), got)
	}
	return nil
}
