// Package like escapes user input for SQL LIKE / ILIKE patterns.
package like

import "strings"

var escaper = strings.NewReplacer(`\`, `\`, `%`, `\%`, `_`, `\_`)

// Escape neutralizes the LIKE metacharacters (backslash, percent, underscore) in a
// user-supplied term, so "50%" or "a_b" match literally instead of as wildcards.
// Use it with the default escape character; pair it with a trigram index for
// substring search (see "When you add a list that can grow" in AGENTS.md).
func Escape(s string) string { return escaper.Replace(s) }
