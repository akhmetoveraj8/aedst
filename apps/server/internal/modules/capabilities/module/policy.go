package module

import (
	"strings"

	"github.com/aedst/server/internal/modules/capabilities/application"
	"github.com/aedst/server/internal/modules/capabilities/domain"
	"github.com/aedst/server/internal/platform/config"
)

// buildPolicy derives what the server advertises from its configuration:
//
//   - clients: AEDST_MIN_CLIENT_VERSIONS and AEDST_RECOMMENDED_CLIENT_VERSIONS;
//   - features, three kinds that cannot collide:
//     coarse ids, one per registered module ("tasks", "media", ...), on unless the
//     operator switches them off; dotted sub-capabilities derived from what this
//     deployment has configured ("media.uploads"); and operator flags and
//     overrides from AEDST_FEATURES (dot-free names, enforced by config validation).
//     An AEDST_FEATURES entry named like a module replaces its default entry, which
//     is how an operator turns a whole module's UI off or gates it by client version.
//
// modules are the registered module names (this one is not a client feature).
func buildPolicy(cfg config.Config, version string, modules []string) (application.Policy, error) {
	flags, err := cfg.Client.Features()
	if err != nil {
		return application.Policy{}, err
	}
	features := derivedFeatures(cfg)
	for _, m := range modules {
		if m != "capabilities" {
			features[m] = domain.Feature{Enabled: true}
		}
	}
	for name, f := range flags {
		features[name] = domain.Feature{Enabled: f.Enabled, Params: f.Params, RequiredClientVersion: strings.TrimPrefix(f.RequiredClientVersion, "v")}
	}

	clients := map[string]domain.ClientVersions{}
	for platform, v := range cfg.Client.MinVersions {
		w := clients[platform]
		w.Minimum = v
		clients[platform] = w
	}
	for platform, v := range cfg.Client.RecommendedVersions {
		w := clients[platform]
		w.Recommended = v
		clients[platform] = w
	}
	return application.Policy{ServerVersion: version, Clients: clients, Features: features}, nil
}

func derivedFeatures(cfg config.Config) map[string]domain.Feature {
	on := func(enabled bool) domain.Feature { return domain.Feature{Enabled: enabled} }
	return map[string]domain.Feature{
		"media.uploads":         on(cfg.Storage.Bucket != ""),
		"media.image_delivery":  on(cfg.Imgproxy.Enabled),
		"push.webpush":          on(cfg.Push.WebPushEnabled()),
		"push.fcm":              on(cfg.Push.FCMEnabled()),
		"push.apns":             on(cfg.Push.APNsEnabled()),
		"auth.oidc":             on(cfg.OIDC.Issuer != ""),
		"attest.play_integrity": on(cfg.Integrity.Enabled),
		"attest.app_attest":     on(cfg.AppAttest.Enabled),
	}
}
