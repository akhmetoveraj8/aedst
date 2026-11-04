// Package domain holds the search module's model: a searchable document is a
// projection of another module's entity, owned by one user.
package domain

import (
	"encoding/base64"
	"errors"
	"fmt"
	"math"
	"strconv"
	"strings"
	"time"
	"unicode/utf8"

	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

// Kind is the kind of entity a document projects.
type Kind string

const (
	KindTask  Kind = "task"
	KindMedia Kind = "media"
)

// Highlight markers wrapped around matched terms in snippets (Unicode private
// use area): clients render them natively without parsing HTML.
const (
	HighlightStart = ""
	HighlightStop  = ""
)

// Limits mirror search.proto.
const (
	MaxQueryLength  = 200
	MaxPrefixLength = 100
	DefaultPageSize = 20
	MaxPageSize     = 50
	DefaultSuggest  = 8
	MaxSuggest      = 20
	// MaxBodyLength bounds what is indexed per document.
	MaxBodyLength = 10_000
)

// Document is one projected entity.
type Document struct {
	Kind      Kind
	EntityID  ids.ID
	OwnerID   ids.ID
	Title     string
	Body      string
	Link      string
	Version   int
	UpdatedAt time.Time
}

// Hit is one search result.
type Hit struct {
	Kind      Kind
	EntityID  ids.ID
	Title     string
	Snippet   string
	Score     float64
	Link      string
	UpdatedAt time.Time
}

// Cursor is the keyset position of a ranked page: the last hit's score and id.
// Query binds a token to the query text it was minted for.
type Cursor struct {
	Query string
	Score float64
	ID    ids.ID
}

const cursorVersion = "s1"

// Encode produces the opaque page token.
func (c Cursor) Encode() string {
	raw := strings.Join([]string{cursorVersion, queryFingerprint(c.Query), strconv.FormatFloat(c.Score, 'g', -1, 64), c.ID.String()}, "|")
	return base64.RawURLEncoding.EncodeToString([]byte(raw))
}

// DecodeCursor parses token for query; "" is the first page (nil).
func DecodeCursor(token, query string) (*Cursor, error) {
	if token == "" {
		return nil, nil
	}
	raw, err := base64.RawURLEncoding.DecodeString(token)
	if err != nil {
		return nil, fmt.Errorf("search: malformed cursor: %w", err)
	}
	parts := strings.Split(string(raw), "|")
	if len(parts) != 4 || parts[0] != cursorVersion {
		return nil, errors.New("search: unsupported cursor")
	}
	if parts[1] != queryFingerprint(query) {
		return nil, errors.New("search: cursor was issued for a different query")
	}
	score, err := strconv.ParseFloat(parts[2], 64)
	if err != nil || math.IsNaN(score) || math.IsInf(score, 0) {
		return nil, errors.New("search: malformed cursor score")
	}
	id, err := ids.Parse(parts[3])
	if err != nil {
		return nil, fmt.Errorf("search: malformed cursor: %w", err)
	}
	return &Cursor{Query: query, Score: score, ID: id}, nil
}

func queryFingerprint(q string) string {
	// Short, stable, not reversible enough to matter: the token is opaque
	// and only replayed by the same caller.
	var h uint32 = 2166136261
	for i := 0; i < len(q); i++ {
		h ^= uint32(q[i])
		h *= 16777619
	}
	return strconv.FormatUint(uint64(h), 36)
}

// NormalizeQuery trims and validates a search query.
func NormalizeQuery(q string) (string, error) {
	q = strings.TrimSpace(q)
	switch {
	case q == "":
		return "", sharederrors.Validation("search.query", "query must not be empty")
	case utf8.RuneCountInString(q) > MaxQueryLength:
		return "", sharederrors.Validation("search.query", "query is too long")
	}
	return q, nil
}

// ClampPageSize applies the default and the maximum.
func ClampPageSize(n int, def, max int) int {
	if n <= 0 {
		return def
	}
	if n > max {
		return max
	}
	return n
}

// TruncateBody bounds indexed text.
func TruncateBody(s string) string {
	if utf8.RuneCountInString(s) <= MaxBodyLength {
		return s
	}
	return string([]rune(s)[:MaxBodyLength])
}
