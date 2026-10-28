#include "Data/local_token_store_adapter.hpp"

#include "aedst/persistence/async_token_store.hpp"

#include <chrono>
#include <cstdint>
#include <utility>

namespace aedst::feature::auth {
namespace {

persistence::StoredTokens toStored(const Session& session) {
    return {
        .userId = session.userId,
        .accessToken = session.accessToken.reveal(),
        .refreshToken = session.refreshToken.reveal(),
        .accessTokenExpiresAtEpochSeconds =
            std::chrono::duration_cast<std::chrono::seconds>(session.accessTokenExpiresAt.time_since_epoch()).count(),
    };
}

std::chrono::system_clock::time_point toTimePoint(std::int64_t epochSeconds) {
    return std::chrono::system_clock::time_point{std::chrono::seconds{epochSeconds}};
}

} // namespace

LocalTokenStoreAdapter::LocalTokenStoreAdapter(std::shared_ptr<persistence::AsyncTokenStore> store)
    : store_(std::move(store)) {}

void LocalTokenStoreAdapter::preload(core::Completion<void> done) {
    {
        const std::scoped_lock lock(mutex_);
        if (cached_) {
            done(core::ok());
            return;
        }
    }
    store_->load([weak = weak_from_this(),
                  done = std::move(done)](core::Outcome<std::optional<persistence::StoredTokens>> stored) {
        const auto self = weak.lock();
        if (!self) {
            return;
        }
        if (!stored) {
            done(core::fail(stored.error()));
            return;
        }
        if (*stored) {
            const std::scoped_lock lock(self->mutex_);
            // A sign-in that completed while the disk was being read wins over the older stored session.
            if (!self->cached_) {
                // Moving the strings into SecretString transfers the buffers; nothing is left behind.
                self->cached_ = CachedSession{
                    .userId = std::move((*stored)->userId),
                    .accessToken = core::SecretString{std::move((*stored)->accessToken)},
                    .refreshToken = core::SecretString{std::move((*stored)->refreshToken)},
                    .accessTokenExpiresAt = toTimePoint((*stored)->accessTokenExpiresAtEpochSeconds),
                };
            }
        }
        done(core::ok());
    });
}

void LocalTokenStoreAdapter::save(const Session& session, core::Completion<void> done) {
    persistence::StoredTokens stored = toStored(session);
    CachedSession next{
        .userId = session.userId,
        .accessToken = session.accessToken,
        .refreshToken = session.refreshToken,
        .accessTokenExpiresAt = session.accessTokenExpiresAt,
    };
    store_->save(stored, [weak = weak_from_this(), next = std::move(next),
                          done = std::move(done)](core::VoidOutcome saved) mutable {
        const auto self = weak.lock();
        if (!self) {
            return;
        }
        if (saved) {
            const std::scoped_lock lock(self->mutex_);
            self->cached_ = std::move(next);
        }
        done(std::move(saved));
    });
    // The queued copy is wiped by the store after use; wipe this one now.
    core::secureWipe(stored.accessToken);
    core::secureWipe(stored.refreshToken);
}

void LocalTokenStoreAdapter::clear(core::Completion<void> done) {
    {
        const std::scoped_lock lock(mutex_);
        cached_.reset(); // ~SecretString wipes both tokens
    }
    store_->clear(std::move(done));
}

core::Outcome<std::optional<Session>> LocalTokenStoreAdapter::load() const {
    const std::scoped_lock lock(mutex_);
    if (!cached_) {
        return std::optional<Session>{};
    }
    return std::optional<Session>{Session{
        .userId = cached_->userId,
        .accessToken = cached_->accessToken,
        .refreshToken = cached_->refreshToken,
        .accessTokenExpiresAt = cached_->accessTokenExpiresAt,
    }};
}

std::optional<std::string> LocalTokenStoreAdapter::accessToken() const {
    const std::scoped_lock lock(mutex_);
    if (!cached_) {
        return std::nullopt;
    }
    return cached_->accessToken.reveal();
}

} // namespace aedst::feature::auth
