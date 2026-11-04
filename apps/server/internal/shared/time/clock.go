// Package time abstracts wall-clock access behind an interface so
// domain/application code can be tested deterministically instead of calling
// time.Now() directly.
package time

import "time"

// Clock provides the current time. Inject it into anything that needs "now"
// so tests can supply a fixed clock.
type Clock interface {
	Now() time.Time
}

// Real is the production Clock, backed by the system clock.
type Real struct{}

func (Real) Now() time.Time { return time.Now().UTC() }

// Fixed is a test Clock that always returns the same instant.
type Fixed struct {
	At time.Time
}

func (f Fixed) Now() time.Time { return f.At }
