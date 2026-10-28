#pragma once

#include <chrono>
#include <cstdint>
#include <google/protobuf/timestamp.pb.h>
#include <optional>

/// google.protobuf.Timestamp <-> std::chrono, shared by every Data layer so no
/// feature re-implements the conversion. An unset message field maps to nullopt
/// (proto3: `has_<field>()` is false), never to the epoch.
namespace aedst::contract {

[[nodiscard]] inline std::chrono::system_clock::time_point toTimePoint(const google::protobuf::Timestamp& ts) {
    using namespace std::chrono;
    return system_clock::time_point{
        duration_cast<system_clock::duration>(seconds{ts.seconds()} + nanoseconds{ts.nanos()})};
}

[[nodiscard]] inline std::optional<std::chrono::system_clock::time_point>
toOptionalTimePoint(bool present, const google::protobuf::Timestamp& ts) {
    return present ? std::optional(toTimePoint(ts)) : std::nullopt;
}

inline void setTimestamp(google::protobuf::Timestamp& ts, std::chrono::system_clock::time_point when) {
    using namespace std::chrono;
    const auto sinceEpoch = when.time_since_epoch();
    auto secs = duration_cast<seconds>(sinceEpoch);
    auto nanos = duration_cast<nanoseconds>(sinceEpoch - secs);
    if (nanos.count() < 0) { // Timestamp.nanos must be in [0, 1e9)
        secs -= seconds{1};
        nanos += seconds{1};
    }
    ts.set_seconds(static_cast<std::int64_t>(secs.count()));
    ts.set_nanos(static_cast<std::int32_t>(nanos.count()));
}

} // namespace aedst::contract
