package pagination_test

import (
	"testing"
	"time"

	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

func BenchmarkCursorRoundTrip(b *testing.B) {
	c := pagination.Cursor{Sort: "created_at:desc", Key: time.Date(2026, 3, 4, 5, 6, 7, 123456000, time.UTC), ID: ids.New()}
	b.ReportAllocs()
	for b.Loop() {
		if _, err := pagination.Decode(c.Encode(), c.Sort); err != nil {
			b.Fatal(err)
		}
	}
}
