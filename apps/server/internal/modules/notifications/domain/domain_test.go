package domain_test

import (
	"strings"
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/notifications/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

func TestBroadcastValidate(t *testing.T) {
	tests := []struct {
		name    string
		b       domain.Broadcast
		wantErr bool
	}{
		{"valid", domain.Broadcast{Title: " Maintenance ", Body: "tonight", Link: "/status"}, false},
		{"no link", domain.Broadcast{Title: "Hi"}, false},
		{"blank title", domain.Broadcast{Title: "  "}, true},
		{"title too long", domain.Broadcast{Title: strings.Repeat("t", domain.MaxTitleLength+1)}, true},
		{"body too long", domain.Broadcast{Title: "x", Body: strings.Repeat("b", domain.MaxBodyLength+1)}, true},
		{"link too long", domain.Broadcast{Title: "x", Link: "/" + strings.Repeat("l", domain.MaxLinkLength)}, true},
		{"absolute link is an open redirect", domain.Broadcast{Title: "x", Link: "https://evil.example"}, true},
		{"protocol-relative link is an open redirect", domain.Broadcast{Title: "x", Link: "//evil.example"}, true},
	}
	for _, tc := range tests {
		t.Run(tc.name, func(t *testing.T) {
			b := tc.b
			err := b.Validate()
			if (err != nil) != tc.wantErr {
				t.Fatalf("err = %v, wantErr %v", err, tc.wantErr)
			}
			if err != nil && sharederrors.KindOf(err) != sharederrors.KindValidation {
				t.Errorf("kind = %v, want validation", sharederrors.KindOf(err))
			}
		})
	}
	b := domain.Broadcast{Title: "  trimmed  "}
	if err := b.Validate(); err != nil || b.Title != "trimmed" {
		t.Errorf("Validate must trim the title in place: %q, %v", b.Title, err)
	}
}

func TestPreferencesWantsPush(t *testing.T) {
	all := domain.DefaultPreferences()
	for _, k := range []domain.Kind{domain.KindTaskCompleted, domain.KindTaskDueSoon, domain.KindMediaReady} {
		if !all.WantsPush(k) {
			t.Errorf("defaults must push %s", k)
		}
	}
	off := all
	off.PushEnabled = false
	if off.WantsPush(domain.KindTaskCompleted) {
		t.Error("PushEnabled=false is a master switch")
	}
	muted := all
	muted.TaskDueSoon = false
	if muted.WantsPush(domain.KindTaskDueSoon) || !muted.WantsPush(domain.KindTaskCompleted) {
		t.Error("per-kind switches must only affect their own kind")
	}
}

func TestNewDevice(t *testing.T) {
	user, now := ids.New(), time.Date(2026, 1, 1, 0, 0, 0, 0, time.UTC)
	t.Run("fcm trims the token", func(t *testing.T) {
		d, err := domain.NewDevice(user, domain.PlatformFCM, "  tok  ", "", "", "", "", false, "Pixel", "en", now)
		if err != nil || d.Address != "tok" || d.UserID != user {
			t.Fatalf("got %+v, %v", d, err)
		}
	})
	t.Run("web push", func(t *testing.T) {
		d, err := domain.NewDevice(user, domain.PlatformWebPush, "", "https://push.example/x", "p", "a", "", false, "", "", now)
		if err != nil || d.Address != "https://push.example/x" || d.P256dh != "p" || d.AuthSecret != "a" {
			t.Fatalf("got %+v, %v", d, err)
		}
	})
	for name, args := range map[string][]any{
		"web push needs https":     {domain.PlatformWebPush, "", "http://push.example/x", "p", "a"},
		"web push needs keys":      {domain.PlatformWebPush, "", "https://push.example/x", "", "a"},
		"apns needs a token":       {domain.PlatformAPNs, "  ", "", "", ""},
		"unknown platform refused": {domain.Platform("sms"), "tok", "", "", ""},
	} {
		_, err := domain.NewDevice(user, args[0].(domain.Platform), args[1].(string), args[2].(string), args[3].(string), args[4].(string), "", false, "", "", now)
		if sharederrors.KindOf(err) != sharederrors.KindValidation {
			t.Errorf("%s: kind = %v, want validation (err=%v)", name, sharederrors.KindOf(err), err)
		}
	}
}

func TestNotificationConstructorsTruncateAndMarkUnread(t *testing.T) {
	long := strings.Repeat("é", 500)
	n := domain.NewTaskCompleted(ids.New(), ids.New(), ids.New(), long, time.Now())
	if got := len([]rune(n.Title)); got > domain.MaxTitleLength {
		t.Errorf("title has %d runes, max %d", got, domain.MaxTitleLength)
	}
	if n.IsRead() {
		t.Error("a new notification is unread")
	}
}
