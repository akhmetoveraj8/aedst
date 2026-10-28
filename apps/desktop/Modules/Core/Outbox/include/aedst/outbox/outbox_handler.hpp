#pragma once

#include "aedst/core/error.hpp"
#include "aedst/core/outcome.hpp"
#include "aedst/outbox/outbox_item.hpp"

#include <functional>
#include <memory>
#include <string>
#include <string_view>
#include <unordered_map>
#include <utility>

namespace aedst::outbox {

enum class DeliveryStatus {
    /// The server applied the operation: the item is removed.
    Delivered,
    /// Could not reach a verdict (offline, timeout, 5xx): the attempt is recorded and the run stops, so a later
    /// item is never delivered ahead of an earlier one. After the 8th failure the item is parked instead.
    Retryable,
    /// The server refused the operation for good (validation, not found, forbidden): the item is parked and the
    /// run continues.
    Permanent,
    /// Nothing can be delivered right now and trying again would not help until something outside the outbox
    /// changes (the session ended, the app must be upgraded): the run stops WITHOUT counting an attempt.
    Blocked,
};

struct DeliveryResult {
    DeliveryStatus status{DeliveryStatus::Delivered};
    /// Error kind recorded in the row (never a message: it could carry user data).
    std::string errorKind;

    [[nodiscard]] static DeliveryResult delivered() { return {DeliveryStatus::Delivered, {}}; }

    [[nodiscard]] static DeliveryResult retryable(std::string kind) {
        return {DeliveryStatus::Retryable, std::move(kind)};
    }

    [[nodiscard]] static DeliveryResult permanent(std::string kind) {
        return {DeliveryStatus::Permanent, std::move(kind)};
    }

    [[nodiscard]] static DeliveryResult blocked(std::string kind) { return {DeliveryStatus::Blocked, std::move(kind)}; }

    /// The one mapping handlers use for a failed call, the outbox column of error-kinds.json: a retryable kind
    /// (unavailable, offline, timeout, rateLimited) and Cancelled (an interrupted attempt, not user intent) are worth
    /// another attempt; an ended session or a required upgrade block the whole queue; everything else is final.
    [[nodiscard]] static DeliveryResult fromError(const core::Error& error) {
        std::string kind(core::toString(error.code));
        switch (error.code) {
        case core::ErrorCode::Unavailable:
        case core::ErrorCode::Offline:
        case core::ErrorCode::Timeout:
        case core::ErrorCode::RateLimited:
        case core::ErrorCode::Cancelled:
            return retryable(std::move(kind));
        case core::ErrorCode::Unauthenticated:
        case core::ErrorCode::UpgradeRequired:
            return blocked(std::move(kind));
        case core::ErrorCode::Unknown:
        case core::ErrorCode::InvalidInput:
        case core::ErrorCode::Forbidden:
        case core::ErrorCode::NotFound:
        case core::ErrorCode::Conflict:
        case core::ErrorCode::Storage:
            break;
        }
        return permanent(std::move(kind));
    }
};

/// What a handler receives for one delivery attempt. `idempotencyKey` is ALWAYS the item id, so every attempt of one
/// item (and a direct call the feature made before queueing it) carries the same key; the handler passes it to the
/// server unchanged (network::CallOptions::idempotencyKey).
struct OutboxDelivery {
    OutboxItem item;
    std::string idempotencyKey;
};

using DeliveryCompletion = std::function<void(DeliveryResult)>;

/// Delivers one kind of queued operation. A feature contributes its handlers from IFeaturePlugin::registerServices()
/// through the ServiceRegistry's OutboxHandlers (see below); the core never knows a feature.
///
/// Contract: complete exactly once (synchronously or later, on the thread the owner of the drainer uses). Never
/// throw for an expected failure; a throw is treated as a permanent failure.
class OutboxHandler {
public:
    OutboxHandler() = default;
    OutboxHandler(const OutboxHandler&) = delete;
    OutboxHandler& operator=(const OutboxHandler&) = delete;
    OutboxHandler(OutboxHandler&&) = delete;
    OutboxHandler& operator=(OutboxHandler&&) = delete;
    virtual ~OutboxHandler() = default;

    /// Matches OutboxItem::type; unique across handlers.
    [[nodiscard]] virtual std::string type() const = 0;
    virtual void deliver(const OutboxDelivery& delivery, DeliveryCompletion done) = 0;
};

/// The handlers contributed so far, by item type. The host provides one instance in the plugin ServiceRegistry before
/// the plugins register; each feature adds its own handlers to it. Not thread-safe (startup, GUI thread).
class OutboxHandlers final {
public:
    /// Fails with InvalidArgument for a null handler or a type that is already taken.
    [[nodiscard]] core::VoidOutcome add(std::shared_ptr<OutboxHandler> handler) {
        if (!handler) {
            return core::fail(core::Error::invalidInput("Cannot add a null outbox handler"));
        }
        std::string type = handler->type();
        const auto [it, inserted] = handlers_.try_emplace(std::move(type), std::move(handler));
        if (!inserted) {
            return core::fail(core::Error::invalidInput("Outbox handler already registered: " + it->first));
        }
        return core::ok();
    }

    /// nullptr for a type nobody handles.
    [[nodiscard]] std::shared_ptr<OutboxHandler> find(std::string_view type) const {
        const auto it = handlers_.find(std::string(type));
        return it == handlers_.end() ? nullptr : it->second;
    }

    [[nodiscard]] std::size_t size() const noexcept { return handlers_.size(); }

private:
    std::unordered_map<std::string, std::shared_ptr<OutboxHandler>> handlers_;
};

} // namespace aedst::outbox
