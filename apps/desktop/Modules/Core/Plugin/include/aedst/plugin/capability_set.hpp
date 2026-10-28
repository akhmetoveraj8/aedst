#pragma once

#include <set>
#include <string>
#include <string_view>
#include <utility>

namespace aedst::plugin {

/// What the server says this deployment (and signed-in user) supports: capability names and
/// feature flags, as published by the aedst.capabilities.v1 service.
///
/// Fail-closed by construction: a default-constructed set is "unknown" (nothing fetched yet or
/// the service is not deployed) and answers false to every query. PluginManager decides what
/// "unknown" means per plugin origin (built-in features keep working, runtime plugins wait).
///
/// Qt-free value type. The generated Protobuf messages are evaluated into it by Core/Capabilities, which
/// is not part of this module, so nothing here depends on generated code.
class CapabilitySet final {
public:
    using Names = std::set<std::string, std::less<>>;

    CapabilitySet() = default;

    [[nodiscard]] static CapabilitySet known(Names capabilities, Names flags) {
        CapabilitySet set;
        set.known_ = true;
        set.capabilities_ = std::move(capabilities);
        set.flags_ = std::move(flags);
        return set;
    }

    [[nodiscard]] bool isKnown() const noexcept { return known_; }

    [[nodiscard]] bool hasCapability(std::string_view name) const { return known_ && capabilities_.contains(name); }

    [[nodiscard]] bool isFlagEnabled(std::string_view name) const { return known_ && flags_.contains(name); }

private:
    bool known_{false};
    Names capabilities_;
    Names flags_;
};

/// Seam for the capabilities source. The server-backed implementation (Aedst::Capabilities, ADR-0035: the
/// CapabilitiesService client plus an on-disk cache) lives in Core/Capabilities; tests use StaticCapabilitySource.
class ICapabilitySource {
public:
    ICapabilitySource() = default;
    ICapabilitySource(const ICapabilitySource&) = delete;
    ICapabilitySource& operator=(const ICapabilitySource&) = delete;
    ICapabilitySource(ICapabilitySource&&) = delete;
    ICapabilitySource& operator=(ICapabilitySource&&) = delete;
    virtual ~ICapabilitySource() = default;

    /// The latest known capabilities; an unknown set when none were fetched.
    [[nodiscard]] virtual CapabilitySet current() const = 0;
};

/// A fixed set, for tests and for builds without a capabilities service.
class StaticCapabilitySource final : public ICapabilitySource {
public:
    StaticCapabilitySource() = default;

    explicit StaticCapabilitySource(CapabilitySet set) : set_(std::move(set)) {}

    [[nodiscard]] CapabilitySet current() const override { return set_; }

private:
    CapabilitySet set_;
};

} // namespace aedst::plugin
