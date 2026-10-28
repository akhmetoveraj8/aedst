#pragma once

#include "aedst/plugin/capability_set.hpp"

#include <aedst/capabilities/v1/capabilities.pb.h>
#include <set>
#include <string>

namespace aedst::capabilities {

/// The wire answer, used as it is (generated from apps/server/api/proto; nothing is mirrored by hand).
using ServerCapabilities = ::aedst::capabilities::v1::GetCapabilitiesResponse;

/// What this desktop build contains, fixed at compile time and supplied by the composition root.
struct ClientBuild {
    using Names = std::set<std::string, std::less<>>;

    /// Key into `clients` of the response ("web", "android", "apple", "desktop").
    std::string platform{"desktop"};
    /// Semver of this build (AEDST_VERSION). Empty or not a semver: a feature that names a
    /// required_client_version is hidden (fail closed) and no version advice is given.
    std::string version;
    /// Coarse feature ids ("tasks", "media", ...) compiled into the client.
    Names features;
    /// Subset of `features` that is off until the server lists it as enabled (optional or experimental features).
    Names flagged;
};

/// The capability negotiation rules (docs/contract/behavior/capabilities.json), as a pure function.
///
/// `server` is the newest answer (a fresh fetch or the last known one), or null when none was ever obtained.
/// For every feature id the build contains:
///  - the server lists it: shown iff `enabled` AND the client meets `required_client_version`
///    (an unparsable requirement hides the feature);
///  - the server does not list it (or `server` is null): a built-in feature is shown, a flagged one is not.
/// Dotted sub-capabilities ("media.uploads") are present iff the server enables them, the client meets their
/// requirement and their coarse parent is shown. Server names the build does not contain are ignored.
///
/// The result is always `known()`: it carries the defaults. Whether the host treats it as authoritative
/// (CapabilitiesService::current) is a separate decision.
[[nodiscard]] plugin::CapabilitySet evaluateCapabilities(const ClientBuild& build, const ServerCapabilities* server);

enum class UpdateAdvice {
    /// Nothing to say (also when versions are missing or unparsable: the server's gate stays authoritative).
    None,
    /// A newer release exists: a non-blocking prompt.
    Recommended,
    /// This build is older than the support window: the blocking upgrade screen.
    Required,
};

struct VersionAdvice {
    UpdateAdvice advice{UpdateAdvice::None};
    /// `clients[platform]` of the answer, empty when not configured. For display.
    std::string minimum;
    std::string recommended;
};

/// Compares this build with `clients[platform]` and `update_status` of the answer.
/// Required: version < minimum. Recommended: version < recommended, or the server says RECOMMENDED.
[[nodiscard]] VersionAdvice adviseVersion(const ClientBuild& build, const ServerCapabilities* server);

} // namespace aedst::capabilities
