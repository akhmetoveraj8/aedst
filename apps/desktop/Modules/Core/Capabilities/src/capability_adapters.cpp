#include "aedst/capabilities/capability_ports.hpp"
#include "aedst/contract/methods.hpp"
#include "aedst/persistence/kv_store.hpp"

#include <chrono>
#include <cstdint>
#include <span>
#include <utility>
#include <vector>

namespace aedst::capabilities {
namespace {

constexpr std::string_view kCacheKey = "capabilities.v1";

std::int64_t nowMs() {
    return std::chrono::duration_cast<std::chrono::milliseconds>(std::chrono::system_clock::now().time_since_epoch())
        .count();
}

} // namespace

ConnectCapabilitiesRemote::ConnectCapabilitiesRemote(std::shared_ptr<network::ConnectClient> client)
    : client_(std::move(client)) {}

void ConnectCapabilitiesRemote::fetch(core::Completion<ServerCapabilities> done) {
    client_->unary(contract::kCapabilitiesGetCapabilities, contract::capabilitiesv1::GetCapabilitiesRequest{},
                   [done = std::move(done)](network::ApiResult<ServerCapabilities> result) {
                       if (!result) {
                           done(core::fail(result.error().toCoreError()));
                           return;
                       }
                       done(std::move(*result));
                   });
}

SqliteCapabilityCache::SqliteCapabilityCache(std::shared_ptr<persistence::DatabaseWorker> worker,
                                             persistence::Dispatcher dispatcher)
    : worker_(std::move(worker)), dispatcher_(std::move(dispatcher)) {}

void SqliteCapabilityCache::load(core::Completion<std::optional<std::string>> done) {
    worker_->run<std::optional<std::string>>(
        [](const std::shared_ptr<persistence::SqliteConnection>& connection)
            -> core::Outcome<std::optional<std::string>> {
            auto stored = persistence::kv::get(*connection, kCacheKey);
            if (!stored) {
                return core::fail(stored.error());
            }
            if (!stored->has_value()) {
                return std::optional<std::string>{};
            }
            const std::vector<std::uint8_t>& bytes = **stored;
            return std::optional<std::string>{std::string(bytes.begin(), bytes.end())};
        },
        dispatcher_, std::move(done));
}

void SqliteCapabilityCache::save(std::string serialized, core::Completion<void> done) {
    worker_->run<void>(
        [serialized = std::move(serialized)](const std::shared_ptr<persistence::SqliteConnection>& connection) {
            const std::vector<std::uint8_t> bytes(serialized.begin(), serialized.end());
            return persistence::kv::put(*connection, kCacheKey, std::span<const std::uint8_t>(bytes), nowMs());
        },
        dispatcher_, std::move(done));
}

} // namespace aedst::capabilities
