package httpserver

import (
	"context"
	"log/slog"
	"slices"
	"strings"

	"connectrpc.com/connect/v2"
	"connectrpc.com/connect/v2/connectproto"
	"go.opentelemetry.io/otel"
	"go.opentelemetry.io/otel/attribute"
	"go.opentelemetry.io/otel/metric"
	"golang.org/x/mod/semver"
	"google.golang.org/genproto/googleapis/rpc/errdetails"

	"github.com/aedst/server/internal/platform/config"
)

// ClientHeader is the request header a first-party client sends to identify
// itself: "<platform>/<semver>", e.g. "android/1.4.2". Platform is one of
// config.ClientPlatforms.
const ClientHeader = "X-Aedst-Client"

// ClientUpgradeRequiredReason is the google.rpc.ErrorInfo reason (domain
// "aedst") attached to the failed_precondition error returned to a client
// older than the configured minimum. Clients match on it to show a forced
// upgrade screen instead of a generic error.
const ClientUpgradeRequiredReason = "CLIENT_UPGRADE_REQUIRED"

// Client statuses recorded on aedst_client_requests_total.
const (
	clientStatusUnidentified = "unidentified" // no or unparsable header
	clientStatusCurrent      = "current"
	clientStatusRecommended  = "below_recommended" // allowed, but older than the recommended release
	clientStatusRejected     = "below_minimum"
)

const clientRequestsCounter = "aedst_client_requests_total"

// ClientVersionInterceptor counts every RPC by client platform, major version
// and support status, and rejects RPCs from a self-identifying client whose
// version is below the minimum configured for its platform (see ADR-0009). It
// is the server half of the API compatibility policy: proto rules keep old
// clients working across additive changes, and this gate is how a release
// that must break them (or drop support for an ancient build) says so
// explicitly, instead of the client failing in some confusing way.
//
// A request that omits the header, names an unknown platform, or carries an
// unparsable version is allowed through: curl, health probes and pre-header
// builds must keep working, and this is a support-window control, not a
// security boundary. minVersions and recommended map platform -> semver
// (without the "v" prefix); empty minVersions disables rejection, empty
// recommended disables the below_recommended status.
//
// The metric's labels are bounded on purpose (the header is attacker
// controlled and this runs before authentication): platform is one of
// config.ClientPlatforms or "none", major is a number below 1000 or "other",
// status is one of four constants. Exact versions are logged on rejection,
// never used as a label.
func ClientVersionInterceptor(ctx context.Context, minVersions, recommended map[string]string, logger *slog.Logger) connect.ServerInterceptor {
	mins, recs := vPrefixed(minVersions), vPrefixed(recommended)
	counter, err := otel.Meter("github.com/aedst/server/internal/platform/httpserver").Int64Counter(clientRequestsCounter,
		metric.WithDescription("RPCs by client platform, major version and support status (from X-Aedst-Client)."))
	if err != nil {
		logger.WarnContext(ctx, "client request metric unavailable", slog.Any("error", err))
	}
	return func(next connect.ServerFunc) connect.ServerFunc {
		return func(ctx context.Context, spec connect.Spec, stream connect.ServerStream) error {
			platform, version, ok := ParseClientHeader(requestHeader(ctx).Get(ClientHeader))
			status := clientStatusUnidentified
			if ok {
				status = clientStatus(platform, version, mins, recs)
			}
			if counter != nil {
				counter.Add(ctx, 1, metric.WithAttributes(
					attribute.String("platform", platformLabel(platform, ok)),
					attribute.String("major", majorLabel(version, ok)),
					attribute.String("status", status),
				))
			}
			if status != clientStatusRejected {
				return next(ctx, spec, stream)
			}
			minimum := mins[platform]
			logger.InfoContext(ctx, "client version rejected",
				slog.String("platform", platform), slog.String("version", version), slog.String("minimum", minimum))
			return clientUpgradeRequired(platform, version, minimum)
		}
	}
}

func vPrefixed(in map[string]string) map[string]string {
	out := make(map[string]string, len(in))
	for platform, version := range in {
		out[strings.ToLower(platform)] = "v" + strings.TrimPrefix(version, "v")
	}
	return out
}

func clientStatus(platform, version string, mins, recs map[string]string) string {
	if minimum, gated := mins[platform]; gated && semver.Compare(version, minimum) < 0 {
		return clientStatusRejected
	}
	if rec, ok := recs[platform]; ok && semver.Compare(version, rec) < 0 {
		return clientStatusRecommended
	}
	return clientStatusCurrent
}

func platformLabel(platform string, identified bool) string {
	if identified && slices.Contains(config.ClientPlatforms, platform) {
		return platform
	}
	return "none"
}

// majorLabel is "1" for v1.4.2; anything not a plain number below 1000 is "other".
func majorLabel(version string, identified bool) string {
	if !identified {
		return "none"
	}
	major := strings.TrimPrefix(semver.Major(version), "v")
	if len(major) == 0 || len(major) > 3 || strings.Trim(major, "0123456789") != "" {
		return "other"
	}
	return major
}

// ParseClientHeader splits "platform/semver" and returns the platform
// lower-cased and the semver with a leading "v" (the form
// golang.org/x/mod/semver requires). ok is false for an absent or malformed header.
func ParseClientHeader(header string) (platform, version string, ok bool) {
	platform, version, found := strings.Cut(strings.TrimSpace(header), "/")
	if !found {
		return "", "", false
	}
	version = "v" + strings.TrimPrefix(strings.TrimSpace(version), "v")
	if !semver.IsValid(version) {
		return "", "", false
	}
	return strings.ToLower(strings.TrimSpace(platform)), version, true
}

func clientUpgradeRequired(platform, version, minimum string) *connect.Error {
	err := connect.Errorf(connect.CodeFailedPrecondition,
		"this version of the %s app is no longer supported; update to %s or newer", platform, strings.TrimPrefix(minimum, "v"))
	if detail, derr := connectproto.NewErrorDetail(&errdetails.ErrorInfo{
		Reason: ClientUpgradeRequiredReason,
		Domain: "aedst",
		Metadata: map[string]string{
			"platform":        platform,
			"client_version":  strings.TrimPrefix(version, "v"),
			"minimum_version": strings.TrimPrefix(minimum, "v"),
		},
	}); derr == nil {
		err = err.WithDetail(detail)
	}
	return err
}
