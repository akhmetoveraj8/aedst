package domain_test

import (
	"testing"
	"time"

	"github.com/aedst/server/internal/modules/notifications/domain"
	sharederrors "github.com/aedst/server/internal/shared/errors"
	"github.com/aedst/server/internal/shared/ids"
)

func TestCheckWebPushEndpoint(t *testing.T) {
	ok := []string{
		"https://fcm.googleapis.com/fcm/send/abc:def",
		"https://updates.push.services.mozilla.com/wpush/v2/gAAAA",
		"https://wns2-par02p.notify.windows.com/w/?token=BQYAAA",
		"https://web.push.apple.com/QGuQyavXutnMH",
		"https://FCM.googleapis.com./fcm/send/x", // case and a trailing dot are normalised
		"https://fcm.googleapis.com:443/fcm/send/x",
	}
	for _, e := range ok {
		if err := domain.CheckWebPushEndpoint(e, nil); err != nil {
			t.Errorf("%s rejected: %v", e, err)
		}
	}
	bad := map[string]string{
		"plain http":           "http://fcm.googleapis.com/fcm/send/x",
		"unknown host":         "https://push.example/x",
		"look-alike suffix":    "https://fcm.googleapis.com.evil.example/x",
		"bare wildcard domain": "https://notify.windows.com/w/",
		"wildcard look-alike":  "https://evilnotify.windows.com/w/",
		"userinfo":             "https://user:pw@fcm.googleapis.com/fcm/send/x",
		"non-default port":     "https://fcm.googleapis.com:8443/fcm/send/x",
		"ipv4 literal":         "https://169.254.169.254/latest/meta-data",
		"ipv6 literal":         "https://[::1]/x",
		"no host":              "https:///x",
		"opaque":               "https:fcm.googleapis.com",
		"not a url":            "://",
		"internal name":        "https://localhost/x",
	}
	for name, e := range bad {
		if err := domain.CheckWebPushEndpoint(e, nil); sharederrors.KindOf(err) != sharederrors.KindValidation {
			t.Errorf("%s (%s): err = %v, want a validation error", name, e, err)
		}
	}
}

func TestCheckWebPushEndpoint_ConfiguredHostsReplaceTheDefaults(t *testing.T) {
	hosts := []string{" Push.Example.com ", "*.corp-push.example"}
	for _, e := range []string{"https://push.example.com/x", "https://a.b.corp-push.example/x"} {
		if err := domain.CheckWebPushEndpoint(e, hosts); err != nil {
			t.Errorf("%s rejected with %v: %v", e, hosts, err)
		}
	}
	if err := domain.CheckWebPushEndpoint("https://fcm.googleapis.com/fcm/send/x", hosts); err == nil {
		t.Error("a default host was accepted although the configured list replaces the defaults")
	}
	policy := domain.DevicePolicy{WebPushHosts: hosts}
	if _, err := policy.NewDevice(ids.New(), domain.PlatformWebPush, "", "https://fcm.googleapis.com/x", "p", "a", "", false, "", "", time.Now()); err == nil {
		t.Error("DevicePolicy.NewDevice ignored its host list")
	}
}
