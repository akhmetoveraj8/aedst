package pagination_test

import (
	"encoding/base64"
	"testing"
	"time"

	"github.com/aedst/server/internal/shared/ids"
	"github.com/aedst/server/internal/shared/pagination"
)

func TestCursor_RoundTrip(t *testing.T) {
	want := pagination.Cursor{
		Sort: "created_at:desc",
		Key:  time.Date(2026, 3, 4, 5, 6, 7, 123456000, time.UTC),
		ID:   ids.New(),
	}
	got, err := pagination.Decode(want.Encode(), "created_at:desc")
	if err != nil {
		t.Fatalf("Decode() error = %v", err)
	}
	if got == nil || got.Sort != want.Sort || !got.Key.Equal(want.Key) || got.ID != want.ID {
		t.Errorf("Decode() = %+v, want %+v", got, want)
	}
}

// A year-1 key (the "no due date" sentinel) must survive the round trip:
// UnixNano would overflow int64 there, which is why keys are microseconds.
func TestCursor_RoundTripSentinelYearOne(t *testing.T) {
	want := pagination.Cursor{Sort: "due_date:asc", Key: time.Date(1, 1, 1, 0, 0, 0, 0, time.UTC), ID: ids.New()}
	got, err := pagination.Decode(want.Encode(), "due_date:asc")
	if err != nil || got == nil || !got.Key.Equal(want.Key) {
		t.Fatalf("Decode() = %+v, %v; want key %v", got, err, want.Key)
	}
}

func TestDecode_EmptyIsFirstPage(t *testing.T) {
	got, err := pagination.Decode("", "created_at:desc")
	if err != nil || got != nil {
		t.Errorf("Decode(\"\") = %v, %v; want nil, nil", got, err)
	}
}

func TestDecode_Rejects(t *testing.T) {
	valid := pagination.Cursor{Sort: "created_at:desc", Key: time.Now(), ID: ids.New()}.Encode()
	tests := map[string]struct{ token, sort string }{
		"not base64":         {"!!!", "created_at:desc"},
		"wrong sort":         {valid, "due_date:asc"},
		"wrong field count":  {base64.RawURLEncoding.EncodeToString([]byte("1|x")), "x"},
		"unknown version":    {base64.RawURLEncoding.EncodeToString([]byte("9|created_at:desc|1|" + ids.New().String())), "created_at:desc"},
		"bad micros":         {base64.RawURLEncoding.EncodeToString([]byte("1|created_at:desc|abc|" + ids.New().String())), "created_at:desc"},
		"bad id":             {base64.RawURLEncoding.EncodeToString([]byte("1|created_at:desc|1|nope")), "created_at:desc"},
		"legacy offset like": {"20", "created_at:desc"},
	}
	for name, tt := range tests {
		t.Run(name, func(t *testing.T) {
			if got, err := pagination.Decode(tt.token, tt.sort); err == nil {
				t.Errorf("Decode() = %+v, want error", got)
			}
		})
	}
}

func TestNewPage(t *testing.T) {
	cursorOf := func(n int) pagination.Cursor { return pagination.Cursor{Sort: "s", Key: time.Unix(int64(n), 0)} }

	t.Run("more rows than limit yields a next cursor from the last kept item", func(t *testing.T) {
		page := pagination.NewPage([]int{1, 2, 3}, 2, cursorOf)
		if len(page.Items) != 2 || page.Next == nil || page.Next.Key.Unix() != 2 {
			t.Errorf("page = %+v, want 2 items and a cursor at item 2", page)
		}
	})
	t.Run("exactly limit rows is the last page", func(t *testing.T) {
		if page := pagination.NewPage([]int{1, 2}, 2, cursorOf); len(page.Items) != 2 || page.Next != nil {
			t.Errorf("page = %+v, want 2 items and no cursor", page)
		}
	})
	t.Run("empty", func(t *testing.T) {
		if page := pagination.NewPage([]int(nil), 2, cursorOf); len(page.Items) != 0 || page.Next != nil {
			t.Errorf("page = %+v, want empty", page)
		}
	})
}

func TestClampLimit(t *testing.T) {
	for in, want := range map[int32]int32{-5: 20, 0: 20, 1: 1, 100: 100, 101: 100} {
		if got := pagination.ClampLimit(in); got != want {
			t.Errorf("ClampLimit(%d) = %d, want %d", in, got, want)
		}
	}
}
