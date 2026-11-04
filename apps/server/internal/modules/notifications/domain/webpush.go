package domain

import (
	"net/netip"
	"net/url"
	"strings"

	sharederrors "github.com/aedst/server/internal/shared/errors"
)

// DefaultWebPushHosts are the push services of the browsers the web client
// supports (the host of PushSubscription.endpoint): Chrome, Opera, Brave and
// Samsung Internet (FCM), Firefox (Mozilla autopush), Edge (Windows Push
// Notification Services, one host per region) and Safari 16+ (Apple).
// "*.example.com" matches any subdomain, never the bare domain.
// AEDST_PUSH_WEBPUSH_HOSTS replaces the list.
var DefaultWebPushHosts = []string{
	"fcm.googleapis.com",
	"updates.push.services.mozilla.com",
	"*.notify.windows.com",
	"web.push.apple.com",
}

// DevicePolicy carries the deployment's device-registration rules. The zero
// value applies the defaults.
type DevicePolicy struct {
	// WebPushHosts is the allow-list of push service hosts; empty means
	// DefaultWebPushHosts.
	WebPushHosts []string
}

// CheckWebPushEndpoint accepts only an https URL on the default port whose
// host is one of hosts (DefaultWebPushHosts when empty). The server POSTs to
// this URL, so anything else (an internal address, an IP literal, userinfo, a
// non-standard port) would turn push delivery into a request forgery primitive.
func CheckWebPushEndpoint(endpoint string, hosts []string) error {
	invalid := func(msg string) error { return sharederrors.Validation("notifications.Device", msg) }
	u, err := url.Parse(endpoint)
	if err != nil || u.Scheme != "https" || u.Opaque != "" || u.Host == "" {
		return invalid("web push endpoint must be an https URL")
	}
	if u.User != nil {
		return invalid("web push endpoint must not carry credentials")
	}
	if port := u.Port(); port != "" && port != "443" {
		return invalid("web push endpoint must use the default https port")
	}
	host := strings.TrimSuffix(strings.ToLower(u.Hostname()), ".")
	if _, err := netip.ParseAddr(host); err == nil {
		return invalid("web push endpoint must name a host, not an IP address")
	}
	if len(hosts) == 0 {
		hosts = DefaultWebPushHosts
	}
	for _, pattern := range hosts {
		if hostMatches(host, strings.ToLower(strings.TrimSpace(pattern))) {
			return nil
		}
	}
	return invalid("web push endpoint is not a known push service")
}

func hostMatches(host, pattern string) bool {
	if suffix, ok := strings.CutPrefix(pattern, "*."); ok {
		return strings.HasSuffix(host, "."+suffix) && len(host) > len(suffix)+1
	}
	return host == pattern
}
