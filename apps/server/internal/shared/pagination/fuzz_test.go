package pagination_test

import (
	"testing"
	"time"

	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

func FuzzDecode(f *testing.F) {
	good := pagination.Cursor{Sort: "created_at:desc", Key: time.Date(2026, 3, 4, 5, 6, 7, 123456000, time.UTC), ID: ids.New()}
	f.Add(good.Encode(), "created_at:desc")
	f.Add("", "x")
	f.Add("%%%%", "x")
	f.Add("dnx8fHw", "")
	f.Fuzz(func(t *testing.T, token, sort string) {
		c, err := pagination.Decode(token, sort)
		if err != nil || c == nil {
			return
		}
		if c.Sort != sort {
			t.Fatalf("cursor for sort %q accepted for %q", c.Sort, sort)
		}
		again, err := pagination.Decode(c.Encode(), sort)
		if err != nil || again == nil || again.Sort != c.Sort || !again.Key.Equal(c.Key) || again.ID != c.ID {
			t.Fatalf("round trip broke: %+v -> %+v (%v)", c, again, err)
		}
	})
}
